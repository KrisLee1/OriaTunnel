use super::*;

pub(super) struct Prepared {
    pub files: Manifest<PlannedEntry>,
    pub completed: HashSet<String>,
    pub direct_paths: bool,
    pub conflict: Option<&'static str>,
}

impl Manager {
    pub(super) async fn prepare(
        &self,
        id: &str,
        sources: &[Entry],
        target: &Entry,
        c: &Control,
    ) -> Result<Prepared> {
        self.archive_completed(id)?;
        let saved = self.tasks.lock().unwrap()[id].scan_cache.clone();
        let mut listings = scan_cache::Listings::open(
            self,
            saved,
            c,
            sources.iter().any(|s| s.meta.kind == "directory"),
        )
        .await?;
        let prepared = self
            .prepare_entries(id, sources, target, c, &mut listings)
            .await;
        listings.finish(self, id, prepared.is_ok());
        prepared
    }

    async fn prepare_entries(
        &self,
        id: &str,
        sources: &[Entry],
        target: &Entry,
        c: &Control,
        listings: &mut scan_cache::Listings,
    ) -> Result<Prepared> {
        let mut root_sizes = vec![Some(0u64); sources.len()];
        let replaying = listings.replaying();
        self.change(id, |t| {
            t.phase = "preparing".into();
            t.source_kinds = sources
                .iter()
                .map(|source| source.meta.kind.clone())
                .collect();
            t.bytes = 0;
            t.total = 0;
            t.count = 0;
            t.scan = (!replaying).then(ScanProgress::default);
            for source in sources {
                if source.meta.kind == "directory" {
                    if let Some(detail) = t.source_details.get_mut(&source.path) {
                        detail.size = None;
                    }
                }
            }
            t.error = None;
            t.conflict = None;
            t.conflict_source = None;
            t.current_source = None;
            if t.skipped_sources.is_empty() {
                t.skipped = 0;
            }
            t.speed = None;
            t.eta = None;
        });
        let mut pending = Manifest::new();
        let mut files = Manifest::new();
        let mut progress = ScanProgress::default();
        let mut last_report = std::time::Instant::now();
        let mut visited = 0;
        // Keep a finite work budget for a misbehaving remote that never reaches EOF.
        // Neither directory width nor the number of files determines resident plan size.
        let mut report_scan = |entry: Option<&Meta>, directory: &str, cached: bool| -> Result<()> {
            if let Some(meta) = entry {
                visited += 1;
                if visited > 10_000_000 {
                    return Err("transferScanLimit".into());
                }
                if cached {
                    return Ok(());
                }
                progress.items += 1;
                if meta.kind == "file" {
                    progress.bytes = progress.bytes.saturating_add(meta.size);
                }
            }
            if (entry.is_some() && progress.items == 1)
                || last_report.elapsed() >= std::time::Duration::from_millis(250)
            {
                directory.clone_into(&mut progress.directory);
                self.change(id, |task| task.scan = Some(progress.clone()));
                last_report = std::time::Instant::now();
            }
            Ok(())
        };
        for (root, source) in sources.iter().enumerate().rev() {
            let name = source
                .path
                .trim_end_matches(['/', '\\'])
                .rsplit(['/', '\\'])
                .next()
                .unwrap_or("");
            report_scan(Some(&source.meta), &source.path, replaying)?;
            pending.push(PlannedEntry {
                root,
                path: source.path.clone(),
                destination: target.fs.join(&target.path, name)?,
                meta: source.meta.clone(),
                cached: false,
            })?;
        }
        let mut conflict = None;
        let mut count = 0;
        let mut total = 0u64;
        let mut resumed_bytes = 0u64;
        let mut direct_paths = true;
        let previous = self.tasks.lock().unwrap()[id].clone();
        let completed = self.completed_paths(&previous)?;
        let skipped = previous.skipped_sources;
        let mut plan_file = |item: PlannedEntry, root_size: &mut Option<u64>| -> Result<()> {
            if let Some(size) = root_size {
                *size = size
                    .checked_add(item.meta.size)
                    .ok_or("transferScanLimit")?;
            }
            if skipped.contains(&item.path) {
                return Ok(());
            }
            total = total
                .checked_add(item.meta.size)
                .ok_or("transferScanLimit")?;
            count += 1;
            if completed.contains(&item.path) {
                resumed_bytes += item.meta.size;
            } else {
                direct_paths &=
                    direct::safe_path(&item.path) && direct::safe_path(&item.destination);
                files.push(item)?;
            }
            Ok(())
        };
        while let Some(mut item) = pending.next()? {
            check(c)?;
            let root_index = item.root;
            let selected = &sources[root_index];
            let root = &selected.path;
            // Never descend through a directory that became a link while paused.
            if item.cached {
                let Some(meta) = cancellable(&c.cancel, selected.fs.meta(&item.path)).await? else {
                    continue;
                };
                item.meta = meta;
                item.cached = false;
            }
            if item.path == *root
                && !self.tasks.lock().unwrap()[id]
                    .source_details
                    .contains_key(root)
            {
                self.change(id, |task| {
                    task.source_details.insert(
                        root.clone(),
                        SourceDetails {
                            destination: item.destination.clone(),
                            size: (item.meta.kind == "file").then_some(item.meta.size),
                        },
                    );
                });
            }
            if item.meta.kind == "file" {
                plan_file(item, &mut root_sizes[root_index])?;
                continue;
            }
            let source = Entry {
                path: item.path,
                meta: item.meta,
                ..selected.clone()
            };
            if skipped.contains(&source.path) {
                if source.meta.kind == "directory" {
                    root_sizes[root_index] = None;
                }
                continue;
            }
            let mut dest = item.destination;
            if source.meta.kind == "directory" {
                if !listings.replaying() {
                    report_scan(None, &source.path, false)?;
                }
                if source.fs.is_windows_directory_link(&source.path).await? {
                    self.mark_skipped(id, &source.path);
                    continue;
                }
                match target.fs.meta(&dest).await? {
                    Some(m) if m.kind == "directory" => {}
                    Some(_) => {
                        let policy = self.conflict_policy(id, &source.path, &dest);
                        if policy == "skip" {
                            self.mark_skipped(id, &source.path);
                            root_sizes[root_index] = None;
                            continue;
                        }
                        if policy == "keep" {
                            let kept = self.tasks.lock().unwrap()[id]
                                .conflict_choices
                                .iter()
                                .find(|choice| {
                                    choice.source.as_deref() == Some(&source.path)
                                        && choice.target == dest
                                })
                                .and_then(|choice| choice.kept.clone());
                            if let Some(kept) = kept {
                                if target
                                    .fs
                                    .meta(&kept)
                                    .await?
                                    .is_none_or(|meta| meta.kind != "directory")
                                {
                                    return Err("targetChanged".into());
                                }
                                dest = kept;
                            } else {
                                let kept = available_name(&target.fs, &dest, "directory").await?;
                                target.fs.mkdir(&kept).await?;
                                self.remember_kept_directory(id, &source.path, &dest, &kept);
                                dest = kept;
                            }
                        } else {
                            if conflict.is_none() {
                                self.record_conflict(id, &source.path, &dest);
                                conflict = Some(if policy == "replace" {
                                    "replaceUnsupported"
                                } else {
                                    "conflict"
                                });
                            }
                            root_sizes[root_index] = None;
                            continue;
                        }
                    }
                    None => target.fs.mkdir(&dest).await?,
                }
                if source.path == *root {
                    self.change(id, |task| {
                        if let Some(detail) = task.source_details.get_mut(root) {
                            detail.destination = dest.clone();
                        }
                    });
                }
                listings
                    .visit(&source, c, |name, meta, cached| {
                        check(c)?;
                        report_scan(Some(&meta), &source.path, cached)?;
                        let child = PlannedEntry {
                            root: root_index,
                            path: source.fs.join(&source.path, &name)?,
                            destination: target.fs.join(&dest, &name)?,
                            meta,
                            cached,
                        };
                        if child.meta.kind == "file" {
                            plan_file(child, &mut root_sizes[root_index])
                        } else {
                            pending.push(child)
                        }
                    })
                    .await?;
            } else {
                self.mark_skipped(id, &source.path);
            }
        }
        check(c)?;
        self.change(id, |t| {
            t.total = total;
            t.count = count;
            t.bytes = resumed_bytes;
            t.scan = None;
            for (source, size) in sources.iter().zip(root_sizes) {
                if let (Some(detail), Some(size)) = (t.source_details.get_mut(&source.path), size) {
                    detail.size = Some(size);
                }
            }
        });
        Ok(Prepared {
            files,
            completed,
            direct_paths,
            conflict,
        })
    }
}
