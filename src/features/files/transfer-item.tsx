import {
  ArrowRightLeft,
  Download,
  Upload,
  Pause,
  Play,
  X,
  Trash2,
  BrushCleaning,
  TriangleAlert,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  active,
  size,
  displayPath,
  type Task,
  type TransferFolder,
} from "./api";
import { FileArtwork } from "./file-artwork";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  transferHosts,
  transferTarget,
  transferTotalSize,
} from "./transfer-list";
import { TransferBatchDetails } from "./transfer-batch-details";
import { TransferPaths } from "./transfer-paths";

export function TransferItem({
  task,
  onAction,
}: {
  task: Task;
  onAction: (action: string, folder?: TransferFolder) => void;
}) {
  const { t, i18n } = useTranslation("files");
  const [batchOpen, setBatchOpen] = useState(false);
  const batch = task.sources.length > 1;
  const started = new Date(task.started);
  const running = active(task),
    finished = ["completed", "partial", "cancelled", "failed"].includes(
      task.phase,
    );
  const upload = task.direction === "upload",
    relay = task.direction === "relay";
  const endpoints = transferHosts(task);
  const sourceRemote = endpoints.source.remote;
  const targetRemote = endpoints.target.remote;
  const sourceName =
    endpoints.source.name || t(sourceRemote ? "remote" : "local");
  const targetName =
    endpoints.target.name || t(targetRemote ? "remote" : "local");
  const names = task.sources
    .map((path) => displayPath(path).split(/[\\/]/).pop())
    .join(", ");
  const target = displayPath(transferTarget(task));
  const totalSize =
    transferTotalSize(task) ??
    (!batch && (task.total > 0 || task.phase === "completed")
      ? task.total
      : null);
  const totalText = totalSize === null ? t("sizeUnknown") : size(totalSize);
  const route = `${sourceName} → ${targetName}${relay ? ` · ${t(task.transport === "direct" ? "directTransfer" : task.transport === "checking" ? "checkingDirect" : "viaLocal")}` : ""}`;
  const error =
    task.error &&
    ![task.phase, "paused", "cancelled", "interrupted"].includes(task.error)
      ? t(task.error, { defaultValue: task.error })
      : null;
  const metrics = [
    [t("transferredSize"), size(task.bytes)],
    [t("totalSize"), totalText],
    [
      t("completedItems"),
      `${task.completed.length}${running ? ` / ${task.count}` : ""}`,
    ],
    ...(task.skipped > 0 ? [[t("skippedItems"), `${task.skipped}`]] : []),
    ...(running && task.speed != null && task.speed > 0
      ? [[t("transferSpeed"), `${size(task.speed)}/s`]]
      : []),
    ...(running && task.eta != null ? [[t("remaining"), `${task.eta}s`]] : []),
  ];
  const metricsLabel = metrics
    .map(([label, value]) => `${label}: ${value}`)
    .join(" · ");
  const iconAction = (
    action: string,
    icon: React.ReactNode,
    label = action,
  ) => (
    <Button
      key={action}
      variant="ghost"
      size="icon-sm"
      aria-label={t(label)}
      title={t(label)}
      onClick={() => onAction(action)}
    >
      {icon}
    </Button>
  );
  const content = (
    <motion.article
      className="files-transfer-row"
      data-transfer-task={task.id}
      initial="rest"
      animate="rest"
      whileHover="artwork-hover"
      whileFocus="artwork-hover"
    >
      {batch ? (
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="files-transfer-artwork files-batch-trigger"
              aria-label={t(batchOpen ? "collapseBatch" : "expandBatch")}
              title={t(batchOpen ? "collapseBatch" : "expandBatch")}
            />
          }
        >
          <FileArtwork name="" kind="batch" />
          <ChevronRight
            className={`files-batch-chevron size-3 transition-transform duration-aide-fast motion-reduce:transition-none ${batchOpen ? "rotate-90" : ""}`}
          />
        </CollapsibleTrigger>
      ) : (
        <FileArtwork
          name={task.sources[0] || ""}
          kind={task.sourceKinds?.[0]}
          className="files-transfer-artwork"
        />
      )}
      <div className="files-transfer-heading">
        <div className="files-transfer-name">
          <strong title={task.sources.map(displayPath).join("\n")}>
            {batch ? t("batchSummary", { count: task.sources.length }) : names}
          </strong>
          <span
            className="files-transfer-direction"
            title={`${t(relay ? "remoteTransfer" : upload ? "upload" : "download")} · ${route}`}
          >
            {relay ? <ArrowRightLeft /> : upload ? <Upload /> : <Download />}
          </span>
        </div>
        {relay && (
          <span className="files-transfer-mode">
            {t(
              task.transport === "direct"
                ? "directTransfer"
                : task.transport === "checking" || !task.transport
                  ? "checkingDirect"
                  : "viaLocal",
            )}
          </span>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                tabIndex={0}
                className="files-transfer-size"
                aria-label={metricsLabel}
              />
            }
          >
            <span className="files-transfer-size-full">
              {running ? `${size(task.bytes)} / ${totalText}` : totalText}
            </span>
            <span className="files-transfer-size-compact" aria-hidden="true">
              {totalText}
            </span>
          </TooltipTrigger>
          <TooltipContent className="files-transfer-info" role="tooltip">
            <dl>
              {metrics.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {error && <p className="files-transfer-error">{error}</p>}
            {task.temp && (
              <p>
                {t("temporary")}
                <code data-selectable="true">{displayPath(task.temp)}</code>
              </p>
            )}
          </TooltipContent>
        </Tooltip>
        <time
          className="files-transfer-time"
          dateTime={started.toISOString()}
          title={started.toLocaleString(i18n.language)}
        >
          {started.toLocaleString(i18n.language, {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
        <Badge
          variant="ghost"
          className={`files-transfer-state files-state-${task.phase}`}
          title={`${t(task.phase)}${error ? ` · ${error}` : ""}`}
        >
          {t(task.phase)}
        </Badge>
        <div className="files-transfer-actions">
          {running ? (
            <>
              {iconAction("pause", <Pause />)}
              {iconAction("cancel", <X />)}
            </>
          ) : (
            <>
              {(!finished || task.phase === "failed") &&
                iconAction(
                  task.phase === "conflict"
                    ? "resolveConflict"
                    : task.directPending || task.error === "commitUnknown"
                      ? "verify"
                      : "resume",
                  task.phase === "conflict" ? <TriangleAlert /> : <Play />,
                  task.phase === "conflict"
                    ? "resolveConflict"
                    : task.directPending
                      ? "verifyDirect"
                      : task.error === "commitUnknown"
                        ? "verifyCommit"
                        : "resume",
                )}
              {!finished && iconAction("cancel", <X />)}
              {finished && !task.temp && iconAction("clear", <Trash2 />)}
              {task.temp &&
                !task.directPending &&
                task.error !== "commitUnknown" &&
                iconAction("cleanup", <BrushCleaning />)}
            </>
          )}
        </div>
      </div>
      <div className="files-transfer-subline">
        <TransferPaths
          source={{
            host: endpoints.source,
            path: batch ? null : task.sources[0],
            description: t("multipleSources", { count: task.sources.length }),
            onOpen: batch
              ? undefined
              : () =>
                  onAction("openFolder", {
                    source: task.sources[0],
                    side: "source",
                  }),
          }}
          target={{
            host: endpoints.target,
            path: target,
            onOpen: () => onAction("openTarget"),
          }}
        />
        {error && (
          <span className="files-transfer-error" title={error}>
            {error}
          </span>
        )}
        {running && (
          <Progress
            className="files-transfer-progress"
            aria-label={t("progress")}
            value={
              task.total > 0
                ? Math.min(100, (task.bytes / task.total) * 100)
                : null
            }
          />
        )}
      </div>
      {batch && (
        <CollapsibleContent className="files-batch-content h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-aide-fast data-starting-style:h-0 data-ending-style:h-0 motion-reduce:transition-none">
          <TransferBatchDetails
            task={task}
            onOpenFolder={(folder) => onAction("openFolder", folder)}
          />
        </CollapsibleContent>
      )}
    </motion.article>
  );
  return batch ? (
    <Collapsible open={batchOpen} onOpenChange={setBatchOpen}>
      {content}
    </Collapsible>
  ) : (
    content
  );
}
