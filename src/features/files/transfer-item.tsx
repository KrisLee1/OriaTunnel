import {
  ArrowRight,
  ArrowRightLeft,
  Download,
  Upload,
  Pause,
  Play,
  X,
  Trash2,
  HardDrive,
  Server,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { active, size, displayPath, type Task } from "./api";

export function TransferItem({
  task,
  onAction,
}: {
  task: Task;
  onAction: (action: string) => void;
}) {
  const { t } = useTranslation("files");
  const running = active(task),
    finished = ["completed", "partial", "cancelled", "failed"].includes(
      task.phase,
    );
  const upload = task.direction === "upload",
    relay = task.direction === "relay";
  const sourceRemote = !!task.sourceRemote || !upload;
  const targetRemote = !!task.targetRemote || upload || relay;
  const sourceName =
    task.sourceRemote?.hostName || (sourceRemote ? task.hostName : t("local"));
  const targetName =
    task.targetRemote?.hostName || (targetRemote ? task.hostName : t("local"));
  const names = task.sources
    .map((path) => displayPath(path).split(/[\\/]/).pop())
    .join(", ");
  const filename =
    task.sources.length === 1
      ? displayPath(task.sources[0]).split(/[\\/]/).pop()
      : undefined;
  const target = displayPath(
    task.destination ||
      (filename
        ? task.target.replace(/[\\/]$/, "") +
          (task.direction === "download" && task.target.includes("\\")
            ? "\\"
            : "/") +
          filename
        : task.target),
  );
  const address = `${targetName} · ${target}`;
  const route = `${sourceName} → ${targetName}${relay ? ` · ${t(task.transport === "direct" ? "directTransfer" : task.transport === "checking" ? "checkingDirect" : "viaLocal")}` : ""}`;
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
  return (
    <article className="files-transfer-row">
      <div className="files-transfer-heading">
        <span
          className="files-transfer-direction"
          title={t(relay ? "remoteTransfer" : upload ? "upload" : "download")}
        >
          {relay ? <ArrowRightLeft /> : upload ? <Upload /> : <Download />}
        </span>
        <strong title={task.sources.map(displayPath).join("\n")}>
          {names}
        </strong>
        <div className="files-transfer-route" title={route}>
          <span>
            {sourceRemote ? <Server /> : <HardDrive />}
            {sourceName}
          </span>
          <ArrowRight />
          <span>
            {targetRemote ? <Server /> : <HardDrive />}
            {targetName}
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
        <Badge
          variant="ghost"
          className={`files-transfer-state files-state-${task.phase}`}
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
                  task.directPending || task.error === "commitUnknown"
                    ? "verify"
                    : "resume",
                  <Play />,
                  task.directPending
                    ? "verifyDirect"
                    : task.error === "commitUnknown"
                      ? "verifyCommit"
                      : "resume",
                )}
              {!finished && iconAction("cancel", <X />)}
              {finished && !task.temp && iconAction("clear", <Trash2 />)}
            </>
          )}
        </div>
      </div>
      <div className="files-transfer-subline">
        {task.direction === "download" ? (
          <button
            type="button"
            className="files-transfer-target"
            title={`${t("openFolder")} · ${address}`}
            onClick={() => onAction("openTarget")}
          >
            {address}
          </button>
        ) : (
          <code data-selectable="true" title={address}>
            {address}
          </code>
        )}
        {running && (
          <Progress
            aria-label={t("progress")}
            value={
              task.total > 0
                ? Math.min(100, (task.bytes / task.total) * 100)
                : null
            }
          />
        )}
        <div className="files-transfer-metrics">
          <span>
            {size(task.bytes)}
            {running && task.total > 0 ? ` / ${size(task.total)}` : ""}
          </span>
          {(task.count > 1 || !running) && (
            <span>
              {t("completedItems")}: {task.completed.length}
              {running ? ` / ${task.count}` : ""}
            </span>
          )}
          {task.skipped > 0 && (
            <span>
              {t("skippedItems")}: {task.skipped}
            </span>
          )}
          {running && task.speed != null && task.speed > 0 && (
            <span>{size(task.speed)}/s</span>
          )}
          {running && task.eta != null && (
            <span>
              {t("remaining")}: {task.eta}s
            </span>
          )}
        </div>
      </div>
      {task.error &&
        ![task.phase, "paused", "cancelled", "interrupted"].includes(
          task.error,
        ) && (
          <p className="files-error">
            {t(task.error, { defaultValue: task.error })}
          </p>
        )}
      {task.conflict && (
        <p className="files-transfer-notice" data-selectable="true">
          {displayPath(task.conflict)}
        </p>
      )}
      {task.phase === "conflict" && (
        <div className="files-transfer-resolve">
          {["skip", "keep", "replace"].map((action) => (
            <Button
              key={action}
              size="sm"
              variant="outline"
              onClick={() => onAction(action)}
            >
              {t(action)}
            </Button>
          ))}
        </div>
      )}
      {task.temp && !running && (
        <details className="files-transfer-notice">
          <summary>{t("temporary")}</summary>
          <code data-selectable="true">{displayPath(task.temp)}</code>
          {!task.directPending && task.error !== "commitUnknown" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction("cleanup")}
            >
              {t("cleanup")}
            </Button>
          )}
        </details>
      )}
    </article>
  );
}
