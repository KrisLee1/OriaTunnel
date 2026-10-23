import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { SearchIcon } from "lucide-react";
import {
  activityRows,
  filterActivity,
  type ActivityGrouping,
  type ActivityRow,
} from "./activity-model";
import type { Snapshot } from "@/types";
import { ActivityList } from "./activity-list";
export function ActivityView({ data }: { data: Snapshot }) {
  const { t } = useTranslation("tunnel");
  const [query, setQuery] = useState("");
  const [warnings, setWarnings] = useState(false);
  const [host, setHost] = useState("all");
  const [forward, setForward] = useState("all");
  const [status, setStatus] = useState("all");
  const [grouping, setGrouping] = useState<ActivityGrouping>("host");
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const rows = activityRows(data);
  const records = filterActivity(
    rows,
    { host, forward, status, query, warnings },
    (key) => t(key),
  );
  const hostName = (row: ActivityRow) =>
    row.host?.name || row.hostId || t("unknownLogHost");
  const forwardName = (row: ActivityRow) =>
    row.hostTest
      ? `${t("testConnection")} · ${hostName(row)}`
      : row.rule?.name || row.record.ruleId;
  const hosts = [
    ...new Map(
      rows.map((row) => [
        row.hostId || "",
        {
          value: row.hostId ? `host:${row.hostId}` : "unknown",
          label: hostName(row),
        },
      ]),
    ).values(),
  ];
  const forwards = [
    ...new Map(
      rows
        .filter((row) => !row.hostTest)
        .map((row) => [
          row.record.ruleId,
          { value: `rule:${row.record.ruleId}`, label: forwardName(row) },
        ]),
    ).values(),
  ];
  const statuses = [...new Set(rows.map((row) => row.status.label))].map(
    (label) => ({ value: label, label: t(label) }),
  );
  const groups = [
    { value: "none", label: t("groupNoneLogs") },
    { value: "host", label: t("groupHost") },
    { value: "forward", label: t("groupForward") },
    { value: "status", label: t("groupStatus") },
  ];
  function picker(
    label: string,
    value: string,
    options: { value: string; label: string }[],
    change: (value: string) => void,
  ) {
    const items = options.some((item) => item.value === value)
      ? options
      : [...options, { value, label: value.replace(/^(host|rule):/, "") }];
    return (
      <Select
        items={items}
        value={value}
        onValueChange={(next) => {
          if (next) change(next);
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label={label}
          title={
            label === t("filterLogHost") ? t("logHostAssociationHint") : label
          }
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <ScrollArea
      className="page-scroll-area"
      viewportClassName="page activity-page scroll-fade"
      viewportRef={setViewport}
    >
      <header className="activity-page-heading">
        <h1>{t("activity")}</h1>
        <span aria-live="polite">
          {t("logCount", { count: records.length })}
        </span>
      </header>
      <div className="host-toolbar activity-toolbar">
        <div className="host-search">
          <SearchIcon size={16} aria-hidden="true" />
          <Input
            type="search"
            aria-label={t("searchLogs")}
            placeholder={t("searchLogs")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="host-toolbar-controls">
          {picker(
            t("filterLogHost"),
            host,
            [{ value: "all", label: t("allLogHosts") }, ...hosts],
            setHost,
          )}
          {picker(
            t("filterLogForward"),
            forward,
            [
              { value: "all", label: t("allLogForwards") },
              ...(rows.some((row) => row.hostTest)
                ? [{ value: "host-tests", label: t("hostTestLogs") }]
                : []),
              ...forwards,
            ],
            setForward,
          )}
          {picker(
            t("filterHostStatus"),
            status,
            [{ value: "all", label: t("allLogStatuses") }, ...statuses],
            setStatus,
          )}
          <Button
            size="sm"
            variant={warnings ? "secondary" : "ghost"}
            aria-pressed={warnings}
            onClick={() => setWarnings(!warnings)}
          >
            {t("warningsOnly")}
          </Button>
          <div className="toolbar-grouping">
            <Separator
              orientation="vertical"
              className="h-5 data-vertical:self-center"
            />
            {picker(t("groupLogs"), grouping, groups, (next) => {
              if (
                next === "none" ||
                next === "host" ||
                next === "forward" ||
                next === "status"
              )
                setGrouping(next);
            })}
          </div>
        </div>
      </div>
      {!records.length ? (
        <p className="muted">{t("noActivity")}</p>
      ) : (
        <ActivityList
          key={JSON.stringify([
            query,
            warnings,
            host,
            forward,
            status,
            grouping,
          ])}
          rows={records}
          grouping={grouping}
          viewport={viewport}
        />
      )}
    </ScrollArea>
  );
}
