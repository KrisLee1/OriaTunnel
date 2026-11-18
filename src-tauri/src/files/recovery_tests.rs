use super::*;

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
