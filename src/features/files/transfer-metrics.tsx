import { useTranslation } from "react-i18next";
import { duration, rate } from "../tunnels/runtime-format";
import { active, type Task } from "./api";

export function useTransferMetrics(task: Task): [string, string][] {
  const { t } = useTranslation("files");
  const { t: unit } = useTranslation("tunnel");
  const units = [
    unit("unitDays"),
    unit("unitHours"),
    unit("unitMinutes"),
    unit("unitSeconds"),
  ];
  const copying = task.phase === "transferring" || task.phase === "committing";
  const elapsed =
    task.elapsedMs ??
    (task.finished != null ? Math.max(0, task.finished - task.started) : null);
  const items: [string, string][] = [];
  if (copying) items.push([t("transferSpeed"), rate(task.speed)]);
  if (elapsed != null || active(task))
    items.push([
      t("elapsed"),
      duration(elapsed == null ? null : elapsed / 1000, units),
    ]);
  if (copying) items.push([t("remaining"), duration(task.eta, units)]);
  return items;
}

export function TransferMetrics({ items }: { items: [string, string][] }) {
  if (!items.length) return null;
  return (
    <dl className="files-transfer-metrics">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
