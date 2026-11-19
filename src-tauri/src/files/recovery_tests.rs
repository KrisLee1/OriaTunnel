use super::*;

#[derive(Clone, Copy, Debug)]
enum FolderStop {
    Pause,
    Shutdown,
    ChannelLoss,
}

#[tokio::test]
async fn interrupted_directory_scan_keeps_complete_listings_and_recovers_a_damaged_cache() {
    let dir = tempfile::tempdir().unwrap();
    let journal = dir.path().join("queue.json");
    let mut entries = vec![];
    for name in ["first", "second"] {
        let folder = dir.path().join(name);
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("child"), b"payload").unwrap();
        let path = folder.to_str().unwrap().to_owned();
        entries.push(Entry {
            mutable: false,
            fs: Fs::Local,
            meta: Fs::Local.meta(&path).await.unwrap().unwrap(),
            path,
            session: None,
        });
    }
    tokio::time::sleep(Duration::from_millis(10)).await;
    let manager = Manager::new(journal.clone());
    manager
        .tasks
        .lock()
        .unwrap()
        .insert("scan".into(), journal_record("scan", "paused"));
    let control = Control {
        cancel: CancellationToken::new(),
        pause: true.into(),
    };
    let mut listings = scan_cache::Listings::open(&manager, None, &control, true)
        .await
        .unwrap();
    listings
        .visit(&entries[0], &control, |_, _, cached| {
            assert!(!cached);
            Ok(())
        })
        .await
        .unwrap();
    let error = listings
        .visit(&entries[1], &control, |_, _, _| {
            control.cancel.cancel();
            check(&control)
        })
        .await
        .unwrap_err();
    assert_eq!(error, "cancelled");
    listings.finish(&manager, "scan", false);
    manager.save();
    drop(manager);

    let manager = Manager::new(journal);
    let control = Control {
        cancel: CancellationToken::new(),
        pause: false.into(),
    };
    let snapshot = || manager.tasks.lock().unwrap()["scan"].scan_cache.clone();
    let mut listings = scan_cache::Listings::open(&manager, snapshot(), &control, true)
        .await
        .unwrap();
    for (i, entry) in entries.iter().enumerate() {
        let mut seen = 0;
        listings
            .visit(entry, &control, |name, _, cached| {
                assert_eq!(name, "child");
                assert_eq!(cached, i == 0);
                seen += 1;
                Ok(())
            })
            .await
            .unwrap();
        assert_eq!(seen, 1);
    }
    listings.finish(&manager, "scan", true);
    let path = manager.archive_path(&snapshot().unwrap().key).unwrap();
    std::fs::write(path, b"truncated").unwrap();
    let mut listings = scan_cache::Listings::open(&manager, snapshot(), &control, true)
        .await
        .unwrap();
    assert!(!listings.replaying());
    listings
        .visit(&entries[0], &control, |name, _, cached| {
            assert_eq!(name, "child");
            assert!(!cached);
            Ok(())
        })
        .await
        .unwrap();
}

#[tokio::test]
async fn large_folder_resume_lists_only_changed_directories_after_restart() {
    const FILES: usize = 1024;
    let local = tempfile::tempdir().unwrap();
    let remote = tempfile::tempdir().unwrap();
    let journal = local.path().join("queue.json");
    let root = remote.path().join("batch");
    let stable = root.join("stable");
    let changed = root.join("changed");
    std::fs::create_dir_all(&stable).unwrap();
    std::fs::create_dir(&changed).unwrap();
    for i in 0..FILES {
        std::fs::write(stable.join(i.to_string()), i.to_le_bytes()).unwrap();
    }
    std::fs::write(changed.join("old"), b"old").unwrap();
    let audit = remote.path().join(".opendir-log");
    std::fs::write(&audit, []).unwrap();
    // The server reports whole seconds. These directories predate the scan.
    tokio::time::sleep(Duration::from_millis(1100)).await;
    let (m, server) = manager(remote.path().into(), journal.clone()).await;
    let src = m
        .directory(Some("session".into()), "/".into())
        .await
        .unwrap();
    let dst = m
        .directory(None, local.path().to_str().unwrap().into())
        .await
        .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let weak = Arc::downgrade(&m);
    let stop_id = id.clone();
    m.set_changed(Arc::new(move |snapshot| {
        if snapshot
            .tasks
            .iter()
            .any(|t| t.id == stop_id && t.phase == "preparing" && t.count == FILES + 1)
        {
            let m = weak.upgrade().unwrap();
            let controls = m.controls.lock().unwrap();
            let control = &controls[&stop_id];
            control.pause.store(true, Ordering::SeqCst);
            control.cancel.cancel();
        }
    }));
    let folder = src.entries.iter().find(|e| e.name == "batch").unwrap();
    m.submit(id.clone(), vec![folder.id.clone()], dst.id)
        .await
        .unwrap();
    let paused = settled(&m, &id).await;
    assert_eq!(paused.phase, "paused");
    let cache = m.archive_path(&paused.scan_cache.unwrap().key).unwrap();
    assert!(cache.exists());
    assert_eq!(
        std::fs::read_to_string(&audit)
            .unwrap()
            .lines()
            .filter(|p| p.starts_with("/batch"))
            .count(),
        3
    );
    std::fs::write(&audit, []).unwrap();
    m.control(&id, "resume", None).await.unwrap();
    let unchanged = settled(&m, &id).await;
    assert_eq!(unchanged.phase, "paused");
    assert_eq!(
        m.archive_path(&unchanged.scan_cache.unwrap().key).unwrap(),
        cache
    );
    assert!(std::fs::read(&audit).unwrap().is_empty());
    m.shutdown().await;
    drop(m);
    server.abort();
    // A new child needs enumeration only in its own directory. A content
    // edit in a cached listing must still transfer the new length and bytes.
    std::fs::write(changed.join("new"), b"new").unwrap();
    std::fs::write(stable.join("0"), b"changed size and content").unwrap();
    std::fs::write(&audit, []).unwrap();
    let (m, server) = manager(remote.path().into(), journal).await;
    m.control(&id, "resume", None).await.unwrap();
    let done = settled_within(&m, &id, Duration::from_secs(120)).await;
    assert_eq!(done.phase, "completed", "{:?}", done.error);
    assert_eq!(
        std::fs::read_to_string(&audit)
            .unwrap()
            .lines()
            .collect::<Vec<_>>(),
        ["/batch/changed"]
    );
    let dest = local.path().join("batch");
    for i in 1..FILES {
        assert_eq!(
            std::fs::read(dest.join("stable").join(i.to_string())).unwrap(),
            i.to_le_bytes()
        );
    }
    assert_eq!(
        std::fs::read(dest.join("stable/0")).unwrap(),
        b"changed size and content"
    );
    assert_eq!(std::fs::read(dest.join("changed/new")).unwrap(), b"new");
    assert_eq!(std::fs::read(dest.join("changed/old")).unwrap(), b"old");
    assert_eq!(done.count, FILES + 2);
    assert_eq!(
        done.bytes,
        ((FILES - 1) * std::mem::size_of::<usize>() + 24 + 6) as u64
    );
    assert_eq!(done.total, done.bytes);
    m.shutdown().await;
    assert!(!cache.exists());
    server.abort();
}

async fn check_nested_resume(
    upload: bool,
    stop: FolderStop,
    native_server: Option<&std::path::Path>,
) {
    const SIZE: usize = 1024 * 1024;
    let local = tempfile::tempdir().unwrap();
    let remote = tempfile::tempdir().unwrap();
    let history = tempfile::tempdir().unwrap();
    let journal = history.path().join("queue.json");
    let (source, target) = if upload {
        (local.path(), remote.path())
    } else {
        (remote.path(), local.path())
    };
    // Identical basenames in different subdirectories must have independent checkpoints.
    let files = [
        "batch/甲/deep/data.bin",
        "batch/乙/deep/data.bin",
        "batch/丙/deep/data.bin",
    ];
    for (i, path) in files.iter().enumerate() {
        let file = source.join(path);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, vec![i as u8; SIZE]).unwrap();
    }
    let connect = || async {
        match native_server {
            Some(exe) => {
                native_download_manager(remote.path().into(), journal.clone(), exe.into()).await
            }
            None => manager(remote.path().into(), journal.clone()).await,
        }
    };
    let (mut m, mut server) = connect().await;
    let remote_dir = m
        .directory(Some("session".into()), ".".into())
        .await
        .unwrap();
    let local_dir = m
        .directory(None, local.path().to_str().unwrap().into())
        .await
        .unwrap();
    let (src, dst) = if upload {
        (local_dir, remote_dir)
    } else {
        (remote_dir, local_dir)
    };
    let folder = src
        .entries
        .iter()
        .find(|entry| entry.name == "batch")
        .unwrap();
    let id = m
        .submit(
            uuid::Uuid::new_v4().to_string(),
            vec![folder.id.clone()],
            dst.id,
        )
        .await
        .unwrap();
    let partial = tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            let task = m.tasks.lock().unwrap()[&id].clone();
            assert!(
                task.active(),
                "stopped before interruption: {:?}",
                task.error
            );
            if !task.completed.is_empty() {
                if let Some(temp) = task.temp {
                    let path = if upload {
                        remote.path().join(temp.trim_start_matches('/'))
                    } else {
                        PathBuf::from(temp)
                    };
                    if let Ok(meta) = path.metadata() {
                        if (1..SIZE as u64).contains(&meta.len()) {
                            break meta.len();
                        }
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .expect("one committed child and one partially written sibling");
    match stop {
        FolderStop::Pause => m.control(&id, "pause", None).await.unwrap(),
        FolderStop::Shutdown => m.shutdown().await,
        FolderStop::ChannelLoss => {
            let Fs::Remote(fs) = m.remotes.lock().unwrap()["session"].clone() else {
                unreachable!()
            };
            fs.raw.close_session().unwrap();
        }
    }
    let stopped = settled(&m, &id).await;
    assert_eq!(
        stopped.phase,
        match stop {
            FolderStop::Pause => "paused",
            FolderStop::Shutdown => "interrupted",
            FolderStop::ChannelLoss => "failed",
        },
        "{:?}",
        stopped.error
    );
    let delivered = files.map(|p| target.join(p).is_file());
    assert_eq!(delivered.iter().filter(|&&yes| yes).count(), 1);
    assert_eq!(stopped.completed.len(), 1);
    // Change every source byte. The delivered file must keep its original contents,
    // and both the partial and pending children must contain only the new bytes.
    for (i, path) in files.iter().enumerate() {
        std::fs::write(source.join(path), vec![i as u8 + 10; SIZE]).unwrap();
    }
    if !matches!(stop, FolderStop::Pause) {
        m.shutdown().await;
        drop(m);
        server.abort();
        (m, server) = connect().await;
    }
    if upload && matches!(stop, FolderStop::ChannelLoss) {
        assert!(stopped.temp.is_some());
        assert_eq!(
            m.control(&id, "resume", None).await.unwrap_err(),
            "cleanupFailed"
        );
        m.control(&id, "cleanup", None).await.unwrap();
    }
    m.control(&id, "resume", None).await.unwrap();
    let done = settled_within(&m, &id, Duration::from_secs(45)).await;
    assert_eq!(done.phase, "completed", "{:?}", done.error);
    assert_eq!(
        (done.count, done.bytes, done.total),
        (
            files.len(),
            (files.len() * SIZE) as u64,
            (files.len() * SIZE) as u64
        )
    );
    assert_eq!(m.completed_paths(&done).unwrap().len(), files.len());
    for (i, path) in files.iter().enumerate() {
        let file = target.join(path);
        let expected = i as u8 + if delivered[i] { 0 } else { 10 };
        let bytes = std::fs::read(&file).unwrap();
        assert_eq!(bytes.len(), SIZE);
        assert!(bytes.iter().all(|&b| b == expected), "{path}");
        assert_eq!(
            std::fs::read_dir(file.parent().unwrap()).unwrap().count(),
            1
        );
    }
    eprintln!("{stop:?}, upload={upload}: one child preserved, two copied; interrupted after {partial}/{SIZE} bytes");
    m.shutdown().await;
    server.abort();
}

#[tokio::test]
async fn nested_folder_resume_over_loopback_sftp() {
    for upload in [true, false] {
        for stop in [
            FolderStop::Pause,
            FolderStop::Shutdown,
            FolderStop::ChannelLoss,
        ] {
            check_nested_resume(upload, stop, None).await;
        }
    }
}

#[cfg(windows)]
#[tokio::test]
#[ignore = "uses the read-only Microsoft Win32-OpenSSH sftp-server specified by ORIA_QA_SFTP_SERVER"]
async fn nested_folder_resume_from_windows_openssh() {
    let exe = PathBuf::from(std::env::var_os("ORIA_QA_SFTP_SERVER").unwrap());
    for stop in [
        FolderStop::Pause,
        FolderStop::Shutdown,
        FolderStop::ChannelLoss,
    ] {
        check_nested_resume(false, stop, Some(&exe)).await;
    }
}

#[tokio::test]
async fn resumes_download_after_the_original_sftp_channel_closes() {
    for shutdown in [false, true] {
        let local = tempfile::tempdir().unwrap();
        let remote = tempfile::tempdir().unwrap();
        let batch = remote.path().join("batch");
        std::fs::create_dir(&batch).unwrap();
        std::fs::write(remote.path().join(".paced-reads"), []).unwrap();
        for i in 0..24u8 {
            std::fs::write(batch.join(i.to_string()), [i; 8192]).unwrap();
        }
        let journal = local.path().join("history.json");
        let (m, original_server) = manager(remote.path().into(), journal.clone()).await;
        let directory = m
            .directory(Some("session".into()), "/".into())
            .await
            .unwrap();
        let batch_id = &directory
            .entries
            .iter()
            .find(|e| e.name == "batch")
            .unwrap()
            .id;
        let dest = m
            .directory(None, local.path().to_str().unwrap().into())
            .await
            .unwrap();
        let id = m
            .submit(
                uuid::Uuid::new_v4().to_string(),
                vec![batch_id.clone()],
                dest.id,
            )
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(20), async {
            while m.tasks.lock().unwrap()[&id].completed.is_empty() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        let stale = m.remotes.lock().unwrap()["session"].clone();
        let Fs::Remote(stale) = stale else {
            unreachable!()
        };
        if shutdown {
            m.shutdown().await;
        } else {
            m.control(&id, "pause", None).await.unwrap();
        }
        let paused = settled(&m, &id).await;
        assert_eq!(
            paused.phase,
            if shutdown { "interrupted" } else { "paused" }
        );
        assert!((1..24).contains(&paused.completed.len()));
        stale.raw.close_session().unwrap();
        tokio::time::timeout(Duration::from_secs(3), stale.raw.closed())
            .await
            .unwrap();
        assert_eq!(
            stale.raw.opendir("/").await.unwrap_err().to_string(),
            "session closed"
        );
        let m = if shutdown {
            Arc::new(Manager::new(journal))
        } else {
            m
        };
        assert_eq!(
            m.control(&id, "resume", Some("session".into()))
                .await
                .unwrap_err(),
            "notConnected"
        );
        let (fresh, server) = setup(remote.path().into(), false).await;
        let new_id = "reconnected";
        m.remotes.lock().unwrap().insert(new_id.into(), fresh);
        m.sessions.lock().unwrap().insert(
            new_id.into(),
            Session {
                id: new_id.into(),
                host_id: "fixture".into(),
                host_name: "loopback".into(),
                phase: "connected".into(),
                route: vec!["fixture".into()],
                fingerprint: None,
                endpoint: None,
                error: None,
            },
        );
        m.route_keys
            .lock()
            .unwrap()
            .insert(new_id.into(), "frozen-fixture".into());
        let committed = std::path::Path::new(&paused.completed[0])
            .file_name()
            .unwrap();
        // Change the already delivered source. Retrying it would overwrite the original or prompt.
        std::fs::write(batch.join(committed), b"changed after pause").unwrap();
        m.control(&id, "resume", Some(new_id.into())).await.unwrap();
        let done = settled(&m, &id).await;
        assert_eq!(done.phase, "completed", "{:?}", done.error);
        assert_eq!(done.completed.len(), 24);
        for i in 0..24u8 {
            assert_eq!(
                std::fs::read(local.path().join("batch").join(i.to_string())).unwrap(),
                [i; 8192]
            );
        }
        m.shutdown().await;
        original_server.abort();
        server.abort();
    }
}

#[tokio::test]
async fn case_alias_cannot_rename_a_leased_remote_file() {
    let local = tempfile::tempdir().unwrap();
    let remote = tempfile::tempdir().unwrap();
    // On a case-sensitive fixture both names exist. SFTP does not advertise which
    // semantics the server uses, so the lease must be conservative in either case.
    for name in ["Docs", "docs"] {
        let dir = remote.path().join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("report"), b"original").unwrap();
    }
    let (m, server) = manager(remote.path().into(), local.path().join("history.json")).await;
    let exact = m
        .directory(Some("session".into()), "/Docs".into())
        .await
        .unwrap();
    let alias = m
        .directory(Some("session".into()), "/docs".into())
        .await
        .unwrap();
    m.lease("transfer", &[m.entry(&exact.entries[0].id).unwrap()])
        .unwrap();
    let alias_id = &alias.entries[0].id;
    assert_eq!(
        m.mutate("rename", alias_id, "renamed").await.unwrap_err(),
        "pathBusy"
    );
    assert_eq!(
        std::fs::read(remote.path().join("docs/report")).unwrap(),
        b"original"
    );
    m.leases.lock().unwrap().remove("transfer");
    m.mutate("rename", alias_id, "renamed").await.unwrap();
    assert_eq!(
        std::fs::read(remote.path().join("docs/renamed")).unwrap(),
        b"original"
    );
    m.shutdown().await;
    server.abort();
}

#[tokio::test]
async fn confirmed_legacy_commits_resume_only_the_remaining_files() {
    for (phase, current_source) in [
        ("committing", false),
        ("interrupted", true),
        ("interrupted", false),
    ] {
        let local = tempfile::tempdir().unwrap();
        let remote = tempfile::tempdir().unwrap();
        let journal = local.path().join("history.json");
        let done = local.path().join("done").to_str().unwrap().to_owned();
        let next = local.path().join("next").to_str().unwrap().to_owned();
        std::fs::write(&done, b"changed since commit").unwrap();
        std::fs::write(&next, b"remaining").unwrap();
        std::fs::write(remote.path().join("done"), b"committed").unwrap();
        let mut task = journal_record("batch", phase);
        task.sources = vec![done.clone(), next.clone()];
        task.completed = vec![done.clone()];
        task.target = "/".into();
        if phase == "interrupted" {
            task.error = Some("commitUnknown".into());
        }
        task.current_source = current_source.then_some(done.clone());
        let mut row = serde_json::to_value(task).unwrap();
        if !current_source {
            row.as_object_mut().unwrap().remove("currentSource");
        }
        std::fs::write(&journal, serde_json::to_vec(&[row]).unwrap()).unwrap();
        let (m, server) = manager(remote.path().into(), journal.clone()).await;
        m.control("batch", "resume", None).await.unwrap();
        let resumed = settled(&m, "batch").await;
        assert_eq!(resumed.phase, "completed");
        assert_eq!(resumed.completed, [done, next]);
        assert_eq!(
            std::fs::read(remote.path().join("done")).unwrap(),
            b"committed"
        );
        assert_eq!(
            std::fs::read(remote.path().join("next")).unwrap(),
            b"remaining"
        );
        m.shutdown().await;
        assert_eq!(Manager::new(journal).snapshot().tasks[0].phase, "completed");
        server.abort();
    }
}

#[tokio::test]
async fn stopping_verification_closes_its_handle_on_the_live_session() {
    let local = tempfile::tempdir().unwrap();
    let remote = tempfile::tempdir().unwrap();
    let src = local.path().join("abc");
    let dest = remote.path().join("abc");
    std::fs::write(&src, b"payload").unwrap();
    std::fs::write(&dest, b"payload").unwrap();
    let journal = local.path().join("history.json");
    let (m, server) = manager(remote.path().into(), journal.clone()).await;
    let mut task = journal_record("verify", "failed");
    task.commit_source = Some(src.to_str().unwrap().into());
    task.commit_target = Some("/abc".into());
    task.error = Some("commitUnknown".into());
    m.tasks.lock().unwrap().insert(task.id.clone(), task);
    m.save();
    let pause = remote.path().join(".pause-verification");
    std::fs::write(&pause, []).unwrap();
    let verify = m.control("verify", "verify", None);
    let stop = async {
        while !remote.path().join(".verification-reading").exists() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        let cancel = m.pending_controls.lock().unwrap()["verify"].clone();
        let release_read = async {
            cancel.cancelled().await;
            // The server cannot process CLOSE until this READ is released.
            assert_eq!(
                m.reserve_control("verify").err().as_deref(),
                Some("taskBusy")
            );
            assert_eq!(
                m.lease_paths("other", vec![("frozen-fixture".into(), "/ABC".into())])
                    .unwrap_err(),
                "pathBusy"
            );
            std::fs::remove_file(pause).unwrap();
        };
        let (stopped, ()) = tokio::join!(m.stop_host_transfers("fixture"), release_read);
        stopped.unwrap();
    };
    let (result, ()) =
        tokio::time::timeout(Duration::from_secs(4), async { tokio::join!(verify, stop) })
            .await
            .unwrap();
    assert_eq!(result.unwrap_err(), "cancelled");
    let fs = m.remotes.lock().unwrap()["session"].clone();
    assert!(fs.meta("/abc").await.unwrap().is_some());
    assert!(
        remote.path().join(".verification-closed").is_file(),
        "server did not receive CLOSE for the interrupted read"
    );
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(dest)
            .unwrap();
    }
    let recovered = Manager::new(journal).snapshot().tasks.pop().unwrap();
    assert_eq!(recovered.error.as_deref(), Some("commitUnknown"));
    assert!(recovered.completed.is_empty());
    m.control("verify", "verify", None).await.unwrap();
    assert_eq!(m.snapshot().tasks[0].phase, "paused");
    m.shutdown().await;
    server.abort();
}

#[test]
fn unfinished_commit_evidence_survives_repeated_restarts() {
    let dir = tempfile::tempdir().unwrap();
    let journal = dir.path().join("history.json");
    let mut rows = Vec::new();
    for (id, phase) in [
        ("temp", "committing"),
        ("source", "interrupted"),
        ("target", "interrupted"),
        ("different-file", "committing"),
        ("empty", "committing"),
        ("direct", "interrupted"),
    ] {
        let mut task = journal_record(id, phase);
        task.error = Some("commitUnknown".into());
        task.completed.push("/previous".into());
        match id {
            "temp" => task.temp = Some("/pending.part".into()),
            "source" => task.commit_source = Some("/source".into()),
            "target" => task.commit_target = Some("/target".into()),
            "different-file" => task.current_source = Some("/next".into()),
            "empty" => task.completed.clear(),
            _ => task.direct_pending = true,
        }
        rows.push(task);
    }
    std::fs::write(&journal, serde_json::to_vec(&rows).unwrap()).unwrap();
    for _ in 0..2 {
        let m = Manager::new(journal.clone());
        m.clear_history();
        let snapshot = m.snapshot();
        assert_eq!(snapshot.tasks.len(), rows.len());
        for task in snapshot.tasks {
            assert_eq!(task.phase, "interrupted");
            let expected = if task.direct_pending {
                "directUnknown"
            } else {
                "commitUnknown"
            };
            assert_eq!(task.error.as_deref(), Some(expected));
            assert!(task.needs_recovery());
        }
    }
}
