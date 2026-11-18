import { PageEmptyState } from "@/components/page-empty-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ClockArrowDown,
  ClockArrowUp,
  ArrowRightLeft,
  BrushCleaning,
  Check,
  HardDriveDownload,
  HardDriveUpload,
  Layers,
  ListTree,
  ListFilter,
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
import { canClearTransfer, type Task, type TransferFolder } from "./api";
import { useLocalDay } from "./time-groups";
import { TransferTaskList } from "./transfer-task-list";
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
  time: "groupTime",
  source: "groupSourceHost",
  target: "groupTargetHost",
  type: "groupTransferType",
};
const groupIcons = {
  none: Layers,
  time: CalendarDays,
  source: HardDriveUpload,
  target: HardDriveDownload,
  type: ArrowRightLeft,
};

export function TransferQueue({
  tasks,
  conflictIds,
  expanded,
  onToggle,
  onAction,
  onClear,
  orientation = "vertical",
}: {
  tasks: Task[];
  conflictIds?: string[];
  expanded: boolean;
  onToggle: () => void;
  onAction: (task: Task, action: string, folder?: TransferFolder) => void;
  onClear: () => void;
  orientation?: "horizontal" | "vertical";
}) {
  const { t } = useTranslation("files");
  const day = useLocalDay();
  const [filter, setFilter] = useState("all");
  const [preferences, setPreferences] = useState<TransferListPreferences>(
    readTransferListPreferences,
  );
  const [limit, setLimit] = useState(200);
  const GroupIcon = groupIcons[preferences.grouping];
  function changePreferences(next: TransferListPreferences) {
    setPreferences(next);
    saveTransferListPreferences(next);
  }
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
    () =>
      groupTransfers(
        filtered,
        preferences.grouping,
        day,
        preferences.order,
        limit,
      ),
    [filtered, limit, preferences.grouping, preferences.order, day],
  );
  const canClear = tasks.some(canClearTransfer);
  if (!expanded && orientation === "horizontal")
    return (
      <section className="files-queue themed-surface workspace-pane-card collapsed files-queue-rail">
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
      className={`files-queue themed-surface workspace-pane-card ${expanded ? "" : "collapsed"}`}
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
                  className="files-queue-options"
                >
                  <DropdownMenuGroup>
                    {transferOrders.map((order) => (
                      <DropdownMenuItem
                        key={order}
                        role="menuitemradio"
                        aria-checked={preferences.order === order}
                        onClick={() =>
                          changePreferences({ ...preferences, order })
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
                  className="files-queue-options"
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
                            changePreferences({ ...preferences, grouping })
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
      {expanded &&
        (!filtered.length ? (
          <ScrollArea
            className="min-h-0 flex-1"
            contentClassName="files-empty-content"
          >
            <PageEmptyState
              compact
              icon={tasks.length ? <ListFilter /> : <ArrowRightLeft />}
              title={t(tasks.length ? "noMatchingTransfers" : "noTransfers")}
              description={!tasks.length && t("emptyTransferHint")}
              action={
                tasks.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setFilter("all")}
                  >
                    {t("clearFilters", { ns: "tunnel" })}
                  </Button>
                )
              }
            />
          </ScrollArea>
        ) : (
          <TransferTaskList
            day={day}
            groups={groups}
            grouped={preferences.grouping !== "none"}
            conflictIds={conflictIds}
            onAction={onAction}
          >
            {filtered.length > limit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLimit((current) => current + 200)}
              >
                {t("loadMoreTasks")}
              </Button>
            )}
          </TransferTaskList>
        ))}
    </section>
  );
}
