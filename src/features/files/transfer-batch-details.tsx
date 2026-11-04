import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { displayPath, size, type Task, type TransferFolder } from "./api";
import { FileArtwork } from "./file-artwork";
import { transferBatchItems, transferHosts } from "./transfer-list";
import { TransferPaths } from "./transfer-paths";

export function TransferBatchDetails({
  task,
  onOpenFolder,
}: {
  task: Task;
  onOpenFolder?: (folder: TransferFolder) => void;
}) {
  const { t } = useTranslation("files");
  const viewport = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => transferBatchItems(task), [task]);
  const height = Math.min(264, rows.length * 44);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => 44,
    initialRect: { width: 600, height },
    overscan: 6,
    useFlushSync: true,
  });
  const endpoints = transferHosts(task);
  return (
    <ScrollArea
      className="files-batch-scroll"
      style={{ height }}
      viewportRef={viewport}
      viewportClassName="scroll-fade"
      aria-label={t("batchDetails")}
    >
      <div
        style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        role="list"
      >
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          const path = displayPath(row.path);
          const name =
            path
              .replace(/[\\/]+$/, "")
              .split(/[\\/]/)
              .pop() || path;
          return (
            <motion.div
              key={row.path}
              role="listitem"
              className="files-batch-item"
              data-batch-source={row.path}
              style={{
                position: "absolute",
                top: item.start,
                left: 0,
                right: 0,
                height: item.size,
              }}
              initial="rest"
              animate="rest"
              whileHover="artwork-hover"
            >
              <FileArtwork name={name} kind={row.kind} />
              <div className="files-batch-item-info">
                <div className="files-batch-item-heading">
                  <strong title={name}>{name}</strong>
                  <span className="files-batch-size" title={t("size")}>
                    {row.size === null ? t("sizeUnknown") : size(row.size)}
                  </span>
                  <Badge
                    variant="ghost"
                    className={`files-batch-state files-state-${row.phase}`}
                    title={t(row.phase)}
                  >
                    {row.kind === "directory" &&
                    row.phase === "unconfirmed" &&
                    row.completedCount > 0
                      ? `${t("completedItems")}: ${row.completedCount}`
                      : t(row.phase)}
                  </Badge>
                </div>
                <TransferPaths
                  source={{
                    host: endpoints.source,
                    path: row.path,
                    onOpen: onOpenFolder
                      ? () => onOpenFolder({ source: row.path, side: "source" })
                      : undefined,
                  }}
                  target={{
                    host: endpoints.target,
                    path: row.destination,
                    onOpen: onOpenFolder
                      ? () => onOpenFolder({ source: row.path, side: "target" })
                      : undefined,
                  }}
                />
              </div>
            </motion.div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
