import { createContext, useContext } from "react";
import { Files } from "lucide-react";
import { useTranslation } from "react-i18next";
import { active, type Task } from "./api";

export type FileActivity = {
  id: string;
  source: string;
  target: string;
  sourceName: string | null;
  targetName: string | null;
  phase: string;
  filename: string;
  relay: boolean;
};
const empty: FileActivity[] = [];
export const FileActivityContext = createContext<FileActivity[]>(empty);
export const useFileActivities = () => useContext(FileActivityContext);

// Metrics are deliberately excluded: byte progress must not rebuild the canvas.
export function projectFileActivities(
  tasks: Task[],
  previous: FileActivity[] = empty,
): FileActivity[] {
  const saved = new Map(previous.map((activity) => [activity.id, activity]));
  const result = tasks
    .filter(
      (task) =>
        active(task) ||
        task.directPending ||
        ["paused", "conflict"].includes(task.phase),
    )
    .flatMap((task) => {
      const sourceId =
        task.sourceRemote?.hostId ||
        (task.direction === "download" ? task.hostId : null);
      const targetId =
        task.targetRemote?.hostId ||
        (task.direction === "upload" ? task.hostId : null);
      if (task.direction === "relay" && (!sourceId || !targetId)) return [];
      const value: FileActivity = {
        id: task.id,
        source: sourceId ? `host:${sourceId}` : "local",
        target: targetId ? `host:${targetId}` : "local",
        sourceName:
          task.sourceRemote?.hostName || (sourceId ? task.hostName : null),
        targetName:
          task.targetRemote?.hostName || (targetId ? task.hostName : null),
        phase:
          task.directPending && !active(task) ? "directUnknown" : task.phase,
        filename:
          (task.destination || task.sources[0] || "").split(/[\\/]/).pop() ||
          "",
        relay:
          task.direction === "relay" &&
          task.transport !== "direct" &&
          task.transport !== "checking",
      };
      const before = saved.get(task.id);
      return [
        before &&
        (Object.keys(value) as (keyof FileActivity)[]).every(
          (key) => before[key] === value[key],
        )
          ? before
          : value,
      ];
    });
  return result.length === previous.length &&
    result.every((item, index) => item === previous[index])
    ? previous
    : result;
}

export function FileTransferStatus({
  nodeId,
  className = "",
}: {
  nodeId: string;
  className?: string;
}) {
  const { t } = useTranslation("files");
  const items = useFileActivities().filter(
    (activity) =>
      activity.source === nodeId ||
      activity.target === nodeId ||
      (activity.relay && nodeId === "local"),
  );
  if (!items.length) return null;
  const moving = items.some((activity) => activity.phase === "transferring");
  const label = t("transferCount", { count: items.length });
  return (
    <span
      className={`file-transfer-status ${className}`}
      data-moving={moving}
      title={`${label}\n${[...new Set(items.map((item) => t(item.phase)))].join(" · ")}`}
      aria-label={label}
    >
      <Files aria-hidden="true" />
      {items.length}
    </span>
  );
}
