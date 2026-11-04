import { useEffect, useMemo, useState } from "react";
import {
  ClockArrowDown,
  ClockArrowUp,
  ArrowRightLeft,
  BrushCleaning,
  Check,
  Download,
  HardDrive,
  HardDriveDownload,
  HardDriveUpload,
  Layers,
  ListTree,
  Server,
  Upload,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Task, TransferFolder } from "./api";
import { TransferItem } from "./transfer-item";
import {
  groupTransfers,
  matchesTransfer,
  orderTransfers,
  readTransferListPreferences,
  saveTransferListPreferences,
  transferGroupings,
  transferOrders,
  type TransferGrouping,
  type TransferListPreferences,
} from "./transfer-list";

const groupLabels: Record<TransferGrouping, string> = {
  none: "noGrouping",
  source: "groupSourceHost",
  target: "groupTargetHost",
  type: "groupTransferType",
};
const groupIcons = {
  none: Layers,
  source: HardDriveUpload,
  target: HardDriveDownload,
  type: ArrowRightLeft,
};

export function TransferQueue({
  tasks,
  expanded,
  onToggle,
  onAction,
  onClear,
  orientation = "vertical",
}: {
  tasks: Task[];
  expanded: boolean;
  onToggle: () => void;
  onAction: (task: Task, action: string, folder?: TransferFolder) => void;
  onClear: () => void;
  orientation?: "horizontal" | "vertical";
}) {
  const { t } = useTranslation("files");
  const [filter, setFilter] = useState("all");
  const [preferences, setPreferences] = useState<TransferListPreferences>(
    readTransferListPreferences,
  );
  const [limit, setLimit] = useState(200);
  const GroupIcon = groupIcons[preferences.grouping];
  useEffect(() => saveTransferListPreferences(preferences), [preferences]);
  useEffect(() => setLimit(200), [filter, preferences]);
  const filtered = useMemo(
    () =>
      orderTransfers(
        tasks.filter((task) => matchesTransfer(task, filter)),
        preferences.order,
      ),
    [tasks, filter, preferences.order],
  );
  const groups = useMemo(
    () => groupTransfers(filtered.slice(0, limit), preferences.grouping),
    [filtered, limit, preferences.grouping],
  );
  const canClear = tasks.some(
    (task) =>
      !task.temp &&
      ["completed", "partial", "failed", "cancelled"].includes(task.phase),
  );
  if (!expanded && orientation === "horizontal")
    return (
      <section className="files-queue themed-surface collapsed files-queue-rail">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("transfers")}
          title={`${t("transfers")} · ${tasks.length}`}
          onClick={onToggle}
        >
          <ListTree />
        </Button>
        <small>{tasks.length}</small>
        <Button
          variant="ghost"
          size="icon-sm"
          className="files-rail-clear"
          aria-label={t("clearHistory")}
          title={t("clearHistory")}
          disabled={!canClear}
          onClick={onClear}
        >
          <BrushCleaning />
        </Button>
      </section>
    );
  return (
    <section
      className={`files-queue themed-surface ${expanded ? "" : "collapsed"}`}
    >
      <div className="files-toolbar">
        <Button variant="ghost" size="sm" onClick={onToggle}>
          {t("transfers")} · {tasks.length}
        </Button>
        {expanded && (
          <div className="files-transfer-filters">
            <Select
              value={filter}
              onValueChange={(value) => value && setFilter(value)}
              items={["all", "active", "attention", "finished"].map(
                (value) => ({ value, label: t(value) }),
              )}
            >
              <SelectTrigger
                size="sm"
                className="w-32"
                aria-label={t("transferStatusFilter")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["all", "active", "attention", "finished"].map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="files-queue-tools">
          {expanded && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("timeOrder")}
                      title={`${t("timeOrder")} · ${t(preferences.order === "newest" ? "newestFirst" : "oldestFirst")}`}
                    >
                      {preferences.order === "newest" ? (
                        <ClockArrowDown />
                      ) : (
                        <ClockArrowUp />
                      )}
                    </Button>
                  }
                />
                <DropdownMenuContent
                  align="end"
                  className="files-options-popup files-queue-options"
                >
                  <DropdownMenuGroup>
                    {transferOrders.map((order) => (
                      <DropdownMenuItem
                        key={order}
                        role="menuitemradio"
                        aria-checked={preferences.order === order}
                        onClick={() =>
                          setPreferences((current) => ({ ...current, order }))
                        }
                      >
                        {order === "newest" ? (
                          <ClockArrowDown />
                        ) : (
                          <ClockArrowUp />
                        )}
                        {t(order === "newest" ? "newestFirst" : "oldestFirst")}
                        {preferences.order === order && (
                          <Check className="ml-auto" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("groupTransfers")}
                      title={`${t("groupTransfers")} · ${t(groupLabels[preferences.grouping])}`}
                    >
                      <GroupIcon />
                    </Button>
                  }
                />
                <DropdownMenuContent
                  align="end"
                  className="files-options-popup files-queue-options"
                >
                  <DropdownMenuGroup>
                    {transferGroupings.map((grouping) => {
                      const Icon = groupIcons[grouping];
                      return (
                        <DropdownMenuItem
                          key={grouping}
                          role="menuitemradio"
                          aria-checked={preferences.grouping === grouping}
                          onClick={() =>
                            setPreferences((current) => ({
                              ...current,
                              grouping,
                            }))
                          }
                        >
                          <Icon />
                          {t(groupLabels[grouping])}
                          {preferences.grouping === grouping && (
                            <Check className="ml-auto" />
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          <Button
            className="files-clear-history"
            variant="ghost"
            size="icon-sm"
            aria-label={t("clearHistory")}
            title={t("clearHistory")}
            disabled={!canClear}
            onClick={onClear}
          >
            <BrushCleaning />
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="files-task-list scroll-fade">
          {filtered.length === 0 && (
            <p className="files-empty">{t("noTransfers")}</p>
          )}
          {groups.map((group) => {
            const label = group.host
              ? group.host.name || t(group.host.remote ? "remote" : "local")
              : t(
                  group.direction === "relay"
                    ? "remoteTransfer"
                    : group.direction || "transfers",
                );
            return (
              <section
                key={group.id}
                className="files-transfer-group"
                aria-label={preferences.grouping === "none" ? undefined : label}
              >
                {preferences.grouping !== "none" && (
                  <h3 className="files-transfer-group-heading">
                    {group.host ? (
                      group.host.remote ? (
                        <Server />
                      ) : (
                        <HardDrive />
                      )
                    ) : group.direction === "upload" ? (
                      <Upload />
                    ) : group.direction === "download" ? (
                      <Download />
                    ) : (
                      <ArrowRightLeft />
                    )}
                    <span title={label}>{label}</span>
                    <small>{group.tasks.length}</small>
                  </h3>
                )}
                {group.tasks.map((task) => (
                  <TransferItem
                    key={task.id}
                    task={task}
                    onAction={(action, folder) =>
                      onAction(task, action, folder)
                    }
                  />
                ))}
              </section>
            );
          })}
          {filtered.length > limit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLimit((current) => current + 200)}
            >
              {t("loadMoreTasks")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
