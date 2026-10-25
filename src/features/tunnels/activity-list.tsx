import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ActivityGrouping, ActivityRow } from "./activity-model";
import {
  ACTIVITY_PAGE_SIZE,
  activityItems,
  activityOffsets,
  activityRange,
} from "./activity-window";

export function ActivityList({
  rows,
  grouping,
  viewport,
}: {
  rows: ActivityRow[];
  grouping: ActivityGrouping;
  viewport: HTMLDivElement | null;
}) {
  const { t, i18n } = useTranslation("tunnel");
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(ACTIVITY_PAGE_SIZE);
  const [view, setView] = useState({ top: 0, height: 800 });
  const items = useMemo(
    () => activityItems(rows, grouping, closed),
    [rows, grouping, closed],
  );
  const loaded = useMemo(() => items.slice(0, limit), [items, limit]);
  const offsets = useMemo(() => activityOffsets(loaded), [loaded]);
  const range = activityRange(offsets, view.top, view.height);
  const hasMore = loaded.length < items.length;
  const showMore = () =>
    setLimit((current) => Math.min(current + ACTIVITY_PAGE_SIZE, items.length));
  useLayoutEffect(() => {
    if (viewport) viewport.scrollTop = 0;
  }, [viewport]);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!viewport || !list) return;
    const update = () => {
      const top =
        viewport.getBoundingClientRect().top - list.getBoundingClientRect().top;
      setView((previous) =>
        previous.top === top && previous.height === viewport.clientHeight
          ? previous
          : { top, height: viewport.clientHeight },
      );
      if (
        hasMore &&
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
          viewport.clientHeight * 2
      )
        showMore();
    };
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(viewport);
    return () => {
      viewport.removeEventListener("scroll", update);
      resize.disconnect();
    };
  }, [viewport, offsets, hasMore, items.length]);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!viewport || !sentinel || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) showMore();
      },
      { root: viewport, rootMargin: `0px 0px ${view.height * 2}px 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [viewport, hasMore, loaded.length, items.length, view.height]);
  const hostName = (row: ActivityRow) =>
    row.host?.name || row.hostId || t("unknownLogHost");
  const forwardName = (row: ActivityRow) =>
    row.hostTest ? t("testConnection") : row.rule?.name || row.record.ruleId;
  return (
    <>
      <div
        ref={listRef}
        className="activity-virtual-list"
        role="list"
        aria-label={t("activity")}
      >
        <div style={{ height: range.before }} aria-hidden="true" />
        {loaded.slice(range.start, range.end).map((item) => (
          <div
            key={item.key}
            style={{ height: item.height }}
            className="activity-virtual-row"
          >
            {item.kind === "group" ? (
              <button
                type="button"
                className="activity-group-toggle"
                aria-expanded={!closed.has(item.groupId)}
                onClick={() =>
                  setClosed((current) => {
                    const next = new Set(current);
                    if (next.has(item.groupId)) next.delete(item.groupId);
                    else next.add(item.groupId);
                    return next;
                  })
                }
              >
                <ChevronRightIcon
                  size={14}
                  className={closed.has(item.groupId) ? "" : "rotate-90"}
                />
                <span
                  title={
                    grouping === "host"
                      ? hostName(item.row)
                      : grouping === "forward"
                        ? forwardName(item.row)
                        : t(item.groupId)
                  }
                >
                  {grouping === "host"
                    ? hostName(item.row)
                    : grouping === "forward"
                      ? forwardName(item.row)
                      : t(item.groupId)}
                </span>
                <small>{item.count}</small>
              </button>
            ) : (
              <article
                className="activity-virtual-entry themed-surface"
                role="listitem"
              >
                <div className="activity-entry-heading">
                  <strong
                    className={`status tone-${item.row.status.tone}`}
                    title={t(item.row.record.event)}
                  >
                    <i />
                    {t(item.row.status.label)}
                  </strong>
                  <time
                    dateTime={new Date(item.row.record.timestamp).toISOString()}
                  >
                    {new Date(item.row.record.timestamp).toLocaleString(
                      i18n.resolvedLanguage,
                    )}
                  </time>
                </div>
                <div className="activity-entry-meta">
                  <span
                    title={`${hostName(item.row)} · ${forwardName(item.row)}`}
                  >
                    {hostName(item.row)} · {forwardName(item.row)}
                  </span>
                  <small title={item.row.record.runId}>
                    {t("retryCount")} {item.row.record.retryCount} ·{" "}
                    {item.row.record.runId.slice(0, 8)}
                  </small>
                </div>
              </article>
            )}
          </div>
        ))}
        <div style={{ height: range.after }} aria-hidden="true" />
      </div>
      <div ref={sentinelRef} className="activity-load-more">
        {hasMore ? (
          <Button size="sm" variant="ghost" onClick={showMore}>
            {t("loadMoreLogs")}
          </Button>
        ) : (
          <small>{t("allLogsLoaded", { count: rows.length })}</small>
        )}
      </div>
    </>
  );
}
