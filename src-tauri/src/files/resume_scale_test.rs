use super::*;
use std::time::Instant;

// Submit through the normal manager, with no completed-path seeds or existing
// destination files. Run explicitly since the destination occupies 61 GiB.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "copies and reads back 250,001 files / 61 GiB over loopback SFTP"]
async fn full_directory_over_loopback_sftp() {
    const FILES: usize = 250_001;
    const LENGTH: usize = 256 * 1024;
    let temp = tempfile::tempdir().unwrap();
    let remote = temp.path().join("remote");
    let local = temp.path().join("local");
    std::fs::create_dir(&remote).unwrap();
    std::fs::create_dir(&local).unwrap();
    let source = remote.join("batch");
    let destination = local.join("batch");
    std::fs::create_dir_all(source.join("nested")).unwrap();
    let name = |i: usize| {
        if i.is_multiple_of(2) {
            PathBuf::from("nested")
        } else {
            PathBuf::new()
        }
        .join(format!("item-{i}"))
    };
    let mut payload = (0..LENGTH).map(|i| (i % 251) as u8).collect::<Vec<_>>();
    for i in 0..FILES {
        let seed = temp.path().join(format!("seed-{}", i / 256));
        if i.is_multiple_of(256) {
            payload[..8].copy_from_slice(&(i as u64).to_le_bytes());
            std::fs::write(&seed, &payload).unwrap();
        }
        std::fs::hard_link(seed, source.join(name(i))).unwrap();
    }
    let journal = temp.path().join("queue.json");
    let native = std::env::var_os("ORIA_QA_SFTP_SERVER");
    let start_path = if native.is_some() { "." } else { "/" };
    let (manager, server) = match native {
        Some(exe) => tests::native_download_manager(remote, journal.clone(), exe.into()).await,
        None => tests::manager(remote, journal.clone()).await,
    };
    let root = manager
        .directory(Some("session".into()), start_path.into())
        .await
        .unwrap();
    let target = manager
        .directory(None, local.to_str().unwrap().into())
        .await
        .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let started = Instant::now();
    manager
        .submit(
            id.clone(),
            vec![
                root.entries
                    .into_iter()
                    .find(|e| e.name == "batch")
                    .unwrap()
                    .id,
            ],
            target.id,
        )
        .await
        .unwrap();
    let mut next_report = 0;
    let task = loop {
        let task = manager.snapshot().tasks.pop().unwrap();
        if !task.active() {
            break task;
        }
        if task.bytes >= next_report {
            eprintln!(
                "full SFTP: {} bytes, {:?}, {:?}",
                task.bytes,
                task.phase,
                started.elapsed()
            );
            next_report += 1024 * 1024 * 1024;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    };
    assert_eq!(
        task.phase, "completed",
        "{:?} after {} bytes",
        task.error, task.bytes
    );
    let total = FILES as u64 * LENGTH as u64;
    assert_eq!(
        (task.count, task.total, task.bytes, task.skipped),
        (FILES, total, total, 0)
    );
    eprintln!(
        "Copied {FILES} files / {total} bytes in {:?}; verifying all destination bytes",
        started.elapsed()
    );
    for i in 0..FILES {
        payload[..8].copy_from_slice(&((i / 256 * 256) as u64).to_le_bytes());
        assert!(
            std::fs::read(destination.join(name(i))).unwrap() == payload,
            "content at item {i}"
        );
    }
    manager.shutdown().await;
    let restored = Manager::new(journal);
    assert_eq!(
        restored
            .completed_paths(&restored.snapshot().tasks[0])
            .unwrap()
            .len(),
        FILES
    );
    server.abort();
    eprintln!("Verified {FILES} files / {total} bytes");
}

#[tokio::test]
async fn downloads_a_paged_directory_with_a_spilled_plan_and_checkpoints() {
    use std::io::Write;
    let local = tempfile::tempdir().unwrap();
    let remote = tempfile::tempdir().unwrap();
    let source = remote.path().join("batch");
    std::fs::create_dir(&source).unwrap();
    for i in 0..300u32 {
        std::fs::write(source.join(i.to_string()), i.to_be_bytes()).unwrap();
    }
    let journal = local.path().join("queue.json");
    let (manager, server) = tests::manager(remote.path().into(), journal.clone()).await;
    let fs = manager.remotes.lock().unwrap()["session"].clone();
    let cancel = CancellationToken::new();
    let mut visited = 0;
    let result = fs
        .visit_directory("/batch", &cancel, |_| {
            visited += 1;
            if visited == 129 {
                cancel.cancel();
            }
            Ok(())
        })
        .await;
    assert_eq!(result.unwrap_err(), "cancelled");
    assert!(visited < 300);

    let root = manager
        .directory(Some("session".into()), "/".into())
        .await
        .unwrap();
    let target = manager
        .directory(None, local.path().to_str().unwrap().into())
        .await
        .unwrap();
    // Individual transfers finish before the progress interval; the batch spans several samples.
    std::fs::write(remote.path().join(".paced-reads"), []).unwrap();
    let measured = Arc::new(AtomicBool::new(false));
    let observed = measured.clone();
    manager.set_changed(Arc::new(move |snapshot| {
        if snapshot.tasks.iter().any(|task| {
            task.speed.is_some_and(|rate| rate > 0)
                && task.eta.is_some_and(|seconds| seconds > 0)
                && task.elapsed_ms.is_some_and(|ms| ms >= 500)
        }) {
            observed.store(true, Ordering::SeqCst);
        }
    }));
    let id = manager
        .submit(
            uuid::Uuid::new_v4().to_string(),
            vec![root.entries[0].id.clone()],
            target.id,
        )
        .await
        .unwrap();
    let task = tests::settled_within(&manager, &id, std::time::Duration::from_secs(90)).await;
    assert_eq!(task.phase, "completed", "{:?}", task.error);
    assert_eq!((task.count, task.bytes), (300, 1200));
    assert!(measured.load(Ordering::SeqCst));
    assert!(task.elapsed_ms.is_some_and(|ms| ms >= 500));
    let measured_elapsed = task.elapsed_ms;
    assert!(task.completed.len() < 130);
    assert!(task.completed_archive.as_ref().unwrap().roots["/batch"] > 250);
    for i in 0..300u32 {
        assert_eq!(
            std::fs::read(local.path().join("batch").join(i.to_string())).unwrap(),
            i.to_be_bytes()
        );
    }
    manager.shutdown().await;
    let dir = journal.with_extension("completed");
    let archive = std::fs::read_dir(&dir)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    // A write that raced a crash past the last committed offset is invisible.
    std::fs::OpenOptions::new()
        .append(true)
        .open(&archive)
        .unwrap()
        .write_all(b"unfinished")
        .unwrap();
    let restored = Manager::new(journal);
    let task = restored.snapshot().tasks.pop().unwrap();
    assert_eq!(task.elapsed_ms, measured_elapsed);
    assert_eq!(restored.completed_paths(&task).unwrap().len(), 300);
    std::fs::OpenOptions::new()
        .write(true)
        .open(&archive)
        .unwrap()
        .set_len(1)
        .unwrap();
    assert_eq!(
        restored.completed_paths(&task).unwrap_err(),
        "journalDamaged"
    );
    restored.clear_history();
    assert!(!archive.exists());
    server.abort();
}

#[tokio::test]
#[ignore = "creates 500,000 directory entries for the large-folder regression"]
async fn resumes_a_sixty_gib_folder_over_loopback_sftp() {
    const FILES: usize = 250_001;
    const REMAINING: usize = 260;
    let local = tempfile::tempdir().unwrap();
    let remote = tempfile::tempdir_in(local.path()).unwrap();
    let source = local.path().join("batch");
    let destination = remote.path().join("batch");
    for root in [&source, &destination] {
        std::fs::create_dir_all(root.join("nested")).unwrap();
    }
    let payload = vec![0x5a; 256 * 1024];
    let mut done = Vec::new();
    for i in 0..FILES {
        // Share fixture payload blocks, below the NTFS link count limit per file.
        let seed = local.path().join(format!("seed-{}", i / 256));
        if i % 256 == 0 {
            std::fs::write(&seed, &payload).unwrap();
        }
        let name = PathBuf::from(if i % 2 == 0 { "nested" } else { "" }).join(format!("item-{i}"));
        let path = source.join(&name);
        std::fs::hard_link(&seed, &path).unwrap();
        if i < FILES - REMAINING {
            std::fs::hard_link(&seed, destination.join(&name)).unwrap();
            done.push(path.to_str().unwrap().to_owned());
        }
    }
    let journal = local.path().join("queue.json");
    let task = serde_json::json!({
        "id":"large","hostId":"fixture","hostName":"fixture","sessionId":"session",
        "direction":"upload","sources":[source],"target":"/","phase":"paused",
        "bytes":0,"total":0,"count":0,"completed":done,"skipped":0,"revision":1,
        "policy":"ask","started":1,"routeKey":"frozen-fixture"
    });
    std::fs::write(&journal, serde_json::to_vec(&vec![task]).unwrap()).unwrap();
    let (manager, server) = tests::manager(remote.path().into(), journal.clone()).await;
    // Exercise a fresh submission too: build the complete spilled copy plan before
    // stopping at the copy boundary so the seeded destination stays intact.
    assert_eq!(
        manager
            .directory(None, source.to_str().unwrap().into())
            .await
            .err()
            .as_deref(),
        Some("directoryBrowseLimit")
    );
    let fresh = uuid::Uuid::new_v4().to_string();
    let probe = fresh.clone();
    let weak = Arc::downgrade(&manager);
    manager.set_changed(Arc::new(move |snapshot| {
        if snapshot
            .tasks
            .iter()
            .any(|t| t.id == probe && t.phase == "preparing" && t.count == FILES)
        {
            let manager = weak.upgrade().unwrap();
            manager.controls.lock().unwrap()[&probe].cancel.cancel();
        }
    }));
    let refs = manager
        .ref_paths(vec![source.to_str().unwrap().into()])
        .await
        .unwrap();
    let dest = manager
        .directory(Some("session".into()), "/".into())
        .await
        .unwrap();
    let scan_start = Instant::now();
    manager.submit(fresh.clone(), refs, dest.id).await.unwrap();
    let scanned = tokio::time::timeout(std::time::Duration::from_secs(300), async {
        loop {
            let task = manager.tasks.lock().unwrap()[&fresh].clone();
            if !task.active() {
                break task;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(scanned.phase, "cancelled");
    assert_eq!(
        (scanned.count, scanned.total, scanned.bytes),
        (FILES, FILES as u64 * payload.len() as u64, 0)
    );
    eprintln!("Fresh plan: {FILES} files in {:?}", scan_start.elapsed());
    manager.control(&fresh, "clear", None).await.unwrap();
    let scans = Arc::new(Mutex::new(Vec::new()));
    let observed = scans.clone();
    manager.set_changed(Arc::new(move |snapshot| {
        let task = &snapshot.tasks[0];
        if let Some(scan) = &task.scan {
            if scan.items > 0 {
                observed.lock().unwrap().push((scan.items, scan.bytes));
            }
        }
    }));
    let started = Instant::now();
    manager
        .control("large", "resume", Some("session".into()))
        .await
        .unwrap();
    let task = tokio::time::timeout(std::time::Duration::from_secs(300), async {
        loop {
            let task = manager.snapshot().tasks.pop().unwrap();
            if !task.active() {
                break task;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(task.phase, "completed", "{:?}", task.error);
    let total = FILES as u64 * payload.len() as u64;
    assert_eq!((task.count, task.total, task.bytes), (FILES, total, total));
    assert!(scans
        .lock()
        .unwrap()
        .iter()
        .any(|&(n, bytes)| n > 50_000 && bytes > 0));
    for i in FILES - REMAINING..FILES {
        let parent = if i % 2 == 0 {
            destination.join("nested")
        } else {
            destination.clone()
        };
        assert_eq!(
            std::fs::read(parent.join(format!("item-{i}"))).unwrap(),
            payload
        );
    }
    manager.shutdown().await;
    let restored = Manager::new(journal.clone());
    assert_eq!(
        restored
            .completed_paths(&restored.snapshot().tasks[0])
            .unwrap()
            .len(),
        FILES
    );
    assert!(std::fs::metadata(&journal).unwrap().len() < 100_000);
    eprintln!(
        "{FILES} files, {total} bytes, {REMAINING} files uploaded, {} scan snapshots, elapsed {:?}",
        scans.lock().unwrap().len(),
        started.elapsed()
    );
    server.abort();
}

#[tokio::test]
async fn resumes_ten_thousand_small_files_without_republishing_completed_paths() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("batch");
    let target = dir.path().join("output");
    let published = target.join("batch");
    std::fs::create_dir_all(&source).unwrap();
    std::fs::create_dir_all(&published).unwrap();
    let mut completed = Vec::new();
    for i in 0..10_000 {
        let name = format!("item-{i:05}");
        let path = source.join(&name);
        std::fs::write(&path, b"x").unwrap();
        if i != 9999 {
            std::fs::write(published.join(name), b"x").unwrap();
            completed.push(path.to_str().unwrap().to_owned());
        }
    }
    let journal = dir.path().join("history.json");
    let task: Task = serde_json::from_value(serde_json::json!({
        "id":"task", "hostId":"fixture", "hostName":"fixture", "sessionId":"session",
        "direction":"download", "sources":[source], "target":target, "phase":"queued",
        "bytes":0, "total":0, "count":0, "completed":completed, "skipped":0,
        "revision":1, "policy":"ask", "started":1, "routeKey":"fixture"
    }))
    .unwrap();
    let manager = Manager::new(journal.clone());
    manager.tasks.lock().unwrap().insert("task".into(), task);
    let checkpoint = Instant::now();
    manager.save();
    let checkpoint_time = checkpoint.elapsed();
    let publications = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = publications.clone();
    manager.set_changed(Arc::new(move |_| {
        counter.fetch_add(1, Ordering::Relaxed);
    }));
    async fn entry(path: PathBuf, session: Option<String>) -> Entry {
        let path = path.to_str().unwrap().to_owned();
        Entry {
            meta: Fs::Local.meta(&path).await.unwrap().unwrap(),
            fs: Fs::Local,
            mutable: false,
            path,
            session,
        }
    }
    let source = entry(source, Some("session".into())).await;
    let target = entry(target, None).await;
    let control = Control {
        cancel: CancellationToken::new(),
        pause: false.into(),
    };
    let start = Instant::now();
    manager
        .run("task", vec![source], target, &control)
        .await
        .unwrap();
    let elapsed = start.elapsed();
    let task = manager.snapshot().tasks.pop().unwrap();
    let updates = publications.load(Ordering::Relaxed);
    eprintln!("10k resume: {elapsed:?}, {updates} snapshots, checkpoint {checkpoint_time:?}, journal {} bytes", std::fs::metadata(&journal).unwrap().len());
    assert_eq!(task.phase, "completed");
    assert_eq!(
        (
            task.count,
            task.bytes,
            manager.completed_paths(&task).unwrap().len()
        ),
        (10_000, 10_000, 10_000)
    );
    assert_eq!(std::fs::read(published.join("item-09999")).unwrap(), b"x");
    let reloaded = Manager::new(journal);
    assert_eq!(
        reloaded
            .completed_paths(&reloaded.snapshot().tasks[0])
            .unwrap()
            .len(),
        10_000
    );
    assert!(updates < 30, "resumed paths must be accounted together");
}
