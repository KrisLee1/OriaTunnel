import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  CheckIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  ServerIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/tunnel-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Host } from "@/types";
import { hostAuthLabels } from "./host-auth";

const AnimatedRefreshIcon = motion.create(RefreshCwIcon);

export function discoveredHosts(hosts: Host[], query: string) {
  const term = query.trim().toLocaleLowerCase();
  return hosts.filter(
    (host) =>
      host.source === "config" &&
      `${host.name} ${host.user} ${host.address} ${host.port} ${host.tags.join(" ")}`
        .toLocaleLowerCase()
        .includes(term),
  );
}

export function HostDiscovery({
  hosts,
  diagnostics,
  busy,
  available,
  close,
  refresh,
  manual,
  select,
}: {
  hosts: Host[];
  diagnostics: string[];
  busy: boolean;
  available: boolean;
  close: () => void;
  refresh: () => void;
  manual: () => void;
  select: (id: string) => void;
}) {
  const { t } = useTranslation("tunnel");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [refreshTurns, setRefreshTurns] = useState(0);
  const reducedMotion = useReducedMotion();
  const list = discoveredHosts(hosts, query);
  const choice = list.find((host) => host.id === selected);
  return (
    <Modal
      title={t("newHost")}
      description={t("discoverHostsHint")}
      close={close}
    >
      {!!discoveredHosts(hosts, "").length && (
        <Input
          type="search"
          aria-label={t("search")}
          placeholder={t("search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      <div className="host-discovery-list" aria-busy={busy}>
        {list.length ? (
          <ScrollArea className="h-full" viewportClassName="p-2">
            <div
              className="host-discovery-options"
              role="group"
              aria-label={t("discoveredHosts")}
            >
              {list.map((host) => (
                <Button
                  key={host.id}
                  type="button"
                  variant="ghost"
                  className="host-discovery-option"
                  aria-pressed={selected === host.id}
                  disabled={busy || !available}
                  onClick={() => setSelected(host.id)}
                >
                  <ServerIcon aria-hidden="true" />
                  <span>
                    <strong>{host.name}</strong>
                    <code>
                      {host.user}@{host.address}:{host.port}
                    </code>
                    {!!host.diagnostics.length && (
                      <small
                        className="inline-error"
                        title={host.diagnostics.join("\n")}
                      >
                        {host.diagnostics[0]}
                      </small>
                    )}
                  </span>
                  <span className="source-badge">
                    {t(hostAuthLabels[host.authMethod])}
                  </span>
                  {selected === host.id && <CheckIcon aria-hidden="true" />}
                </Button>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="host-discovery-empty" role="status">
            {busy && (
              <LoaderCircleIcon
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            {t(
              busy
                ? "discoveringHosts"
                : query.trim()
                  ? "noMatchingHosts"
                  : "noDiscoveredHosts",
            )}
          </div>
        )}
      </div>
      {diagnostics.map((message, index) => (
        <p key={index} className="inline-error">
          {t(message)}
        </p>
      ))}
      {!available && <p className="muted">{t("browserPreview")}</p>}
      <div className="host-discovery-actions">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("refresh")}
          title={t("refresh")}
          disabled={busy || !available}
          onClick={() => {
            setRefreshTurns((turns) => turns + 1);
            refresh();
          }}
        >
          <AnimatedRefreshIcon
            aria-hidden="true"
            initial={false}
            animate={{ rotate: refreshTurns * 360 }}
            transition={{ duration: reducedMotion ? 0 : 0.45, ease: "easeInOut" }}
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy || !available}
          onClick={manual}
        >
          {t("manual")}
        </Button>
        <Button
          type="button"
          disabled={busy || !available || !choice}
          onClick={() => {
            if (choice) select(choice.id);
          }}
        >
          {t("addDiscoveredHost")}
        </Button>
      </div>
    </Modal>
  );
}
