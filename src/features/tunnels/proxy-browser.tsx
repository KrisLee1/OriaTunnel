import { GlobeIcon } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ServiceIconStrip } from "@/features/commands/service-icon-strip";
import { useServiceRunning } from "@/features/commands/service-running-context";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { ProxyBrowser } from "@/lib/bridge";
import type { Rule, Runtime } from "@/types";
import type { RemoteService } from "@/types";
import { ConnectionIcon } from "./connection-icon";
import edgeIcon from "@/assets/microsoftedge.svg";
import chromeIcon from "@/assets/googlechrome.svg";
import firefoxIcon from "@/assets/firefoxbrowser.svg";

export const proxyBrowserChoices: readonly {
  id: ProxyBrowser;
  name: string;
  icon: string;
}[] = [
  { id: "edge", name: "Microsoft Edge", icon: edgeIcon },
  { id: "chrome", name: "Google Chrome", icon: chromeIcon },
  { id: "firefox", name: "Mozilla Firefox", icon: firefoxIcon },
];

type ListenerRuntime = Pick<Runtime, "status" | "configurationChanged">;

export function proxyBrowserUnavailableReason(
  rule: Rule,
  runtime?: ListenerRuntime,
) {
  if (rule.kind !== "D") return "serviceDynamic";
  if (!runtime || runtime.status !== "listening") return "serviceStartFirst";
  if (runtime.configurationChanged) return "serviceReconnect";
  return null;
}

type ProxyServiceButtonsProps = {
  rule: Rule;
  runtime?: ListenerRuntime;
  services?: RemoteService[];
  desktop: boolean;
  onOpen: (id: string, browser: ProxyBrowser, serviceId?: string) => void;
  expandable?: boolean;
};
export const ProxyServiceButtons = memo(
  function ProxyServiceButtons({
    rule,
    runtime,
    services = [],
    desktop,
    onOpen,
    expandable = true,
  }: ProxyServiceButtonsProps) {
    if (rule.kind !== "D") return null;
    const linked = services.filter(
      (s) =>
        s.ruleIds.includes(rule.id) && (s.hostIds || []).includes(rule.hostId),
    );
    if (!linked.length) return null;
    const icons = (
      <div className="service-command-icons inline-flex flex-wrap items-center gap-1 nodrag nopan">
        {linked.map((service) => (
          <OpenProxyBrowserButton
            key={service.id}
            rule={rule}
            runtime={runtime}
            desktop={desktop}
            service={service}
            onOpen={onOpen}
          />
        ))}
      </div>
    );
    return (
      <ServiceIconStrip
        className="proxy-service-strip"
        count={linked.length}
        expandable={expandable}
      >
        {icons}
      </ServiceIconStrip>
    );
  },
  (before, after) =>
    before.rule === after.rule &&
    before.services === after.services &&
    before.desktop === after.desktop &&
    before.onOpen === after.onOpen &&
    before.expandable === after.expandable &&
    before.runtime?.status === after.runtime?.status &&
    before.runtime?.configurationChanged ===
      after.runtime?.configurationChanged,
);

export function OpenProxyBrowserButton({
  rule,
  runtime,
  desktop,
  onOpen,
  service,
}: {
  rule: Rule;
  runtime?: ListenerRuntime;
  desktop: boolean;
  onOpen: (id: string, browser: ProxyBrowser, serviceId?: string) => void;
  service?: RemoteService;
}) {
  const { t } = useTranslation("tunnel");
  const running = useServiceRunning(service, rule.hostId);
  if (rule.kind !== "D") return null;
  const reason =
    service && !service.port
      ? "servicePort"
      : desktop
        ? proxyBrowserUnavailableReason(rule, runtime)
        : "serviceDesktopOnly";
  return (
    <span
      className="service-open-action nodrag nopan inline-flex"
      title={t(reason || "openProxyBrowser")}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button type="button" variant="ghost" size="icon-sm" />}
          disabled={!!reason}
          aria-label={`${t("openProxyBrowser")} ${service?.name || rule.name}`}
        >
          {service ? (
            <span
              className="inline-flex"
              style={{ filter: running ? undefined : "grayscale(1)" }}
            >
              <ConnectionIcon
                icon={service.icon}
                color={
                  running
                    ? service.color || "var(--oria-color-accent)"
                    : "var(--oria-color-muted-fg)"
                }
              />
            </span>
          ) : (
            <GlobeIcon />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {proxyBrowserChoices.map((browser) => (
            <DropdownMenuItem
              key={browser.id}
              onClick={() => onOpen(rule.id, browser.id, service?.id)}
            >
              <img
                src={browser.icon}
                alt=""
                aria-hidden="true"
                className="size-4 shrink-0 object-contain"
              />
              {browser.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
