import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { Progress } from "@/components/ui/progress";
import { active, transferPercent, displayPath, size, type Task } from "./api";
import { FileTransferDetailsContext } from "./transfer-state";
import { TransferMetrics, useTransferMetrics } from "./transfer-metrics";

export function TransferDetails({ taskIds }: { taskIds: string[] }) {
  const tasks = useContext(FileTransferDetailsContext).filter((task) =>
    taskIds.includes(task.id),
  );
  const { t } = useTranslation("files");
  return (
    <div className="files-edge-details">
      <strong>{t("transferCount", { count: tasks.length })}</strong>
      {tasks.slice(0, 3).map((task) => (
        <TransferDetail key={task.id} task={task} />
      ))}
      {tasks.length > 3 && (
        <p>{t("moreTransfers", { count: tasks.length - 3 })}</p>
      )}
    </div>
  );
}

function TransferDetail({ task }: { task: Task }) {
  const { t, i18n } = useTranslation("files");
  const timing = useTransferMetrics(task);
  const source =
    task.sourceRemote?.hostName ||
    (task.direction === "download" ? task.hostName : t("local"));
  const target =
    task.targetRemote?.hostName ||
    (task.direction !== "download" ? task.hostName : t("local"));
  const mode =
    task.direction === "relay"
      ? task.transport === "direct"
        ? "directTransfer"
        : task.transport === "checking" || !task.transport
          ? "checkingDirect"
          : "viaLocal"
      : task.direction;
  const phase = task.directPending ? "directUnknown" : task.phase;
  const running = active(task);
  const scan = task.phase === "preparing" ? task.scan : null;
  return (
    <section className="files-edge-detail">
      <strong>
        {task.sources
          .map((path) => displayPath(path).split(/[\\/]/).pop())
          .join(", ")}
      </strong>
      <code>
        {displayPath(task.destination || task.conflict || task.target)}
      </code>
      <div className="files-edge-detail-line">
        <span>
          {source} → {target}
        </span>
        <span>
          {t(mode)} · {t(phase)}
        </span>
      </div>
      <div className="files-edge-detail-line">
        <span>
          {scan
            ? t("scannedItems", {
                items: scan.items.toLocaleString(i18n.language),
              })
            : size(task.bytes)}
          {scan
            ? ` · ${size(scan.bytes)}`
            : task.total > 0
              ? ` / ${size(task.total)}`
              : ""}
        </span>
      </div>
      <TransferMetrics items={timing} />
      {running && (
        <Progress aria-label={t("progress")} value={transferPercent(task)} />
      )}
    </section>
  );
}
