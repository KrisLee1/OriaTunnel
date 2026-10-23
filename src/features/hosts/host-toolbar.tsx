import { SearchIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { HostGrouping } from "./host-groups";

export function HostToolbar({
  query,
  filter,
  grouping,
  onQuery,
  onFilter,
  onGrouping,
}: {
  query: string;
  filter: string;
  grouping: HostGrouping;
  onQuery: (query: string) => void;
  onFilter: (filter: string) => void;
  onGrouping: (grouping: HostGrouping) => void;
}) {
  const { t } = useTranslation("tunnel");
  const groups = [
    { value: "none", label: t("groupNone") },
    { value: "tags", label: t("groupTags") },
    { value: "auth", label: t("groupAuth") },
    { value: "status", label: t("groupStatus") },
  ];
  const statuses = [
    { value: "all", label: t("all") },
    { value: "untested", label: t("untested") },
    { value: "tested", label: t("filterPassed") },
    { value: "errors", label: t("filterErrors") },
    ...[
      "authentication-error",
      "host-key-error",
      "dns-error",
      "timeout",
      "network-error",
      "bind-error",
      "forward-error",
      "configuration-error",
      "command-error",
      "connection-error",
    ].map((kind) => ({ value: `status-${kind}`, label: t(`status-${kind}`) })),
  ];
  return (
    <div className="host-toolbar">
      <div className="host-search">
        <SearchIcon size={16} aria-hidden="true" />
        <Input
          type="search"
          aria-label={t("search")}
          placeholder={t("search")}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </div>
      <div className="host-toolbar-controls">
        <Select
          items={statuses}
          value={filter}
          onValueChange={(value) => {
            if (value) onFilter(value);
          }}
        >
          <SelectTrigger
            size="sm"
            className="host-status-select"
            aria-label={t("filterHostStatus")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {statuses.map((status) => (
              <SelectItem key={status.value} value={status.value}>
                {status.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="toolbar-grouping">
          <Separator
            orientation="vertical"
            className="h-5 data-vertical:self-center"
          />
          <Select
            items={groups}
            value={grouping}
            onValueChange={(value) => {
              if (
                value === "none" ||
                value === "tags" ||
                value === "auth" ||
                value === "status"
              )
                onGrouping(value);
            }}
          >
            <SelectTrigger
              size="sm"
              className="host-group-select"
              aria-label={t("groupHosts")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {groups.map((group) => (
                <SelectItem key={group.value} value={group.value}>
                  {group.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
