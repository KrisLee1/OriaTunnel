use super::*;
use std::time::Instant;

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
    eprintln!("10k resume: {elapsed:?}, {updates} snapshots, checkpoint {checkpoint_time:?}, journal {} bytes", std::fs::metadata(journal).unwrap().len());
    assert_eq!(task.phase, "completed");
    assert_eq!(
        (task.count, task.bytes, task.completed.len()),
        (10_000, 10_000, 10_000)
    );
    assert_eq!(std::fs::read(published.join("item-09999")).unwrap(), b"x");
    assert!(updates < 30, "resumed paths must be accounted together");
}
