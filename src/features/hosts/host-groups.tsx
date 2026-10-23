import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { ServerIcon } from "lucide-react";
import { motion } from "motion/react";
import { useEntranceMotion } from "@/components/ui/motion";
import type { Host, Runtime } from "@/types";
import { runtimeStatus } from "@/features/tunnels/runtime-status";
import { hostAuthLabels } from "./host-auth";
import { hostFilterStatus } from "./host-collection";
export type HostGrouping = "none" | "tags" | "auth" | "status";
export function groupHosts(
  hosts: Host[],
  grouping: HostGrouping,
  runtimes: Runtime[] = [],
) {
  const groups = new Map<string, Host[]>();
  for (const host of hosts) {
    const keys =
      grouping === "status"
        ? [
            hostFilterStatus(
              host,
              runtimes.find(
                (runtime) => runtime.ruleId === `host-test:${host.id}`,
              ),
            ) || "",
          ]
        : grouping === "auth"
          ? [host.authMethod]
          : grouping === "tags"
            ? [...new Set(host.tags.map((t) => t.trim()).filter(Boolean))]
            : [""];
    for (const key of keys.length ? keys : [""])
      groups.set(key, [...(groups.get(key) || []), host]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}
export function HostGroups({
  hosts,
  runtimes,
  grouping,
  selected,
  actions,
}: {
  hosts: Host[];
  runtimes: Runtime[];
  grouping: HostGrouping;
  selected?: string;
  actions: (host: Host, runtime?: Runtime) => ReactNode;
}) {
  const { t } = useTranslation("tunnel");
  const entrance = useEntranceMotion(4);
  const groups = groupHosts(hosts, grouping, runtimes);
  const items = (list: Host[]) =>
    list.map((h) => {
      const runtime = runtimes.find(
        (item) => item.ruleId === "host-test:" + h.id,
      );
      const status = runtime ? runtimeStatus(runtime) : null;
      return (
        <motion.article
          className={`host-item themed-surface ${selected === h.id ? "selected" : ""}`}
          key={h.id}
          {...entrance}
        >
          <ServerIcon size={16} aria-hidden="true" />
          <div className="host-item-content">
            <span className="host-item-heading">
              <strong title={h.name}>{h.name}</strong>
              <span
                className={`status tone-${status?.tone || (h.diagnostics.length ? "danger" : "neutral")}`}
                title={runtime?.message || h.diagnostics.join("\n")}
              >
                <i />
                {t(
                  status?.label ||
                    (h.diagnostics.length
                      ? "status-configuration-error"
                      : "untested"),
                )}
              </span>
            </span>
            <span className="host-item-meta">
              <code title={`${h.user}@${h.address}:${h.port}`}>
                {h.user}@{h.address}:{h.port}
              </code>
              <span className="source-badge">
                {t(hostAuthLabels[h.authMethod])}
              </span>
            </span>
          </div>
          <div className="host-item-actions">{actions(h, runtime)}</div>
        </motion.article>
      );
    });
  return (
    <div className="host-list">
      {groups.map(([key, list]) =>
        grouping === "none" || (grouping === "status" && !key) ? (
          <div className="host-group" key={key}>
            {items(list)}
          </div>
        ) : (
          <details className="host-group" key={key} open>
            <summary>
              {grouping === "status"
                ? t(key === "tested" ? "filterPassed" : key)
                : grouping === "auth"
                  ? t(hostAuthLabels[key as Host["authMethod"]])
                  : key || t("ungrouped")}{" "}
              · {list.length}
            </summary>
            {items(list)}
          </details>
        ),
      )}
    </div>
  );
}
