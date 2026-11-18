import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
  type VirtualItem,
} from "@tanstack/react-virtual";
import {
  ArrowRightLeft,
  Download,
  HardDrive,
  Server,
  Upload,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Task, TransferFolder } from "./api";
import { TransferItem } from "./transfer-item";
import { TIME_HEADING_HEIGHT, timeGroupLabel } from "./time-groups";
import type { TransferGroup } from "./transfer-list";

export function TransferTaskList({
  groups,
  day,
  grouped,
  conflictIds,
  onAction,
  children,
}: {
  groups: TransferGroup[];
  day: number;
  grouped: boolean;
  conflictIds?: string[];
  onAction: (task: Task, action: string, folder?: TransferFolder) => void;
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation("files");
  const viewport = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () =>
      groups.flatMap((group) =>
        group.tasks.map((task, i) => ({
          task,
          group,
          indexInGroup: i,
          heading: grouped && i === 0,
        })),
      ),
    [groups, grouped],
  );
  const [focused, setFocused] = useState<string>();
  const [openBatches, setOpenBatches] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const keepBatch = useCallback((id: string, open: boolean) => {
    setOpenBatches((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  // Keep an active control's focus and an expanded batch's inner scroll position.
  const pinned = useMemo(
    () =>
      rows.flatMap(({ task }, i) =>
        task.id === focused || openBatches.has(task.id) ? [i] : [],
      ),
    [rows, focused, openBatches],
  );
  const rangeExtractor = useCallback(
    (range: Range) => {
      const visible = defaultRangeExtractor(range);
      return pinned.length
        ? [...new Set([...visible, ...pinned])].sort((a, b) => a - b)
        : visible;
    },
    [pinned],
  );
  const list = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewport.current,
    getItemKey: useCallback((i: number) => rows[i].task.id, [rows]),
    estimateSize: (i) => (rows[i].heading ? 92 : 64),
    initialRect: { width: 400, height: 400 },
    overscan: 4,
    rangeExtractor,
  });
  const visibleGroups = new Map<TransferGroup, VirtualItem[]>();
  for (const item of list.getVirtualItems()) {
    const group = rows[item.index].group;
    const items = visibleGroups.get(group);
    if (items) items.push(item);
    else visibleGroups.set(group, [item]);
  }
  return (
    <ScrollArea
      className="min-h-0 flex-1"
      viewportRef={viewport}
      viewportClassName="files-task-list scroll-fade"
      contentClassName="px-2 pb-2"
      viewportProps={{
        onFocusCapture: (event) =>
          setFocused(
            event.target.closest<HTMLElement>("[data-transfer-task]")?.dataset
              .transferTask,
          ),
        onBlurCapture: (event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setFocused(undefined);
        },
      }}
    >
      <div style={{ position: "relative", height: list.getTotalSize() }}>
        {Array.from(visibleGroups, ([group, items]) => {
          const label = group.time
            ? timeGroupLabel(group.time, t, i18n.language, day)
            : group.host
              ? group.host.name || t(group.host.remote ? "remote" : "local")
              : t(
                  group.direction === "relay"
                    ? "remoteTransfer"
                    : group.direction || "transfers",
                );
          const Icon = group.host
            ? group.host.remote
              ? Server
              : HardDrive
            : group.direction === "upload"
              ? Upload
              : group.direction === "download"
                ? Download
                : ArrowRightLeft;
          const firstIndex = items[0].index - rows[items[0].index].indexInGroup;
          const top = group.time ? list.measurementsCache[firstIndex].start : 0;
          const bounds = group.time
            ? {
                position: "absolute" as const,
                insetInline: 0,
                top,
                height:
                  list.measurementsCache[firstIndex + group.tasks.length - 1]
                    .end - top,
              }
            : undefined;
          return (
            <section
              key={group.id}
              className="files-transfer-group"
              style={bounds}
              aria-label={grouped ? label : undefined}
            >
              {group.time && (
                <h3
                  className="files-time-heading"
                  style={{ height: TIME_HEADING_HEIGHT }}
                >
                  <span>
                    {label}
                    <small>{group.count ?? group.tasks.length}</small>
                  </span>
                </h3>
              )}
              {items.map((item) => {
                const { task, heading } = rows[item.index];
                return (
                  <div
                    key={task.id}
                    className="files-queue-entry"
                    ref={list.measureElement}
                    data-index={item.index}
                    style={{
                      transform: `translateY(${item.start - top}px)`,
                      paddingTop:
                        heading && group.time ? TIME_HEADING_HEIGHT : undefined,
                    }}
                  >
                    {heading && !group.time && (
                      <h3 className="files-transfer-group-heading">
                        <Icon />
                        <span title={label}>{label}</span>
                        <small>{group.count ?? group.tasks.length}</small>
                      </h3>
                    )}
                    <TransferItem
                      task={task}
                      canResolve={!conflictIds || conflictIds.includes(task.id)}
                      onBatchOpenChange={keepBatch}
                      onAction={(action, folder) =>
                        onAction(task, action, folder)
                      }
                    />
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      {children}
    </ScrollArea>
  );
}
