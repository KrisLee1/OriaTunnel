import type { ReactNode } from "react";
import { RotateCwIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { TerminalSession } from "@/types";
import { terminalStateTone } from "./terminal-model";

export function PaneIdentity({
  session,
  busy,
  retryProfile,
  reconnect,
  grip,
  closeButton,
}: {
  session: TerminalSession;
  busy: boolean;
  retryProfile: boolean;
  reconnect: () => void;
  grip: ReactNode;
  closeButton: ReactNode;
}) {
  const { t } = useTranslation("terminal");
  const retry = retryProfile
    ? t("retryAuth", { ns: "commands" })
    : t("reconnect");
  const identity =
    grip && session.label !== session.endpoint
      ? session.label + " · " + session.endpoint
      : session.endpoint;
  return (
    <div className="terminal-identity">
      {grip}
      {grip && (
        <span
          className="terminal-tab-indicator"
          data-tone={terminalStateTone(session)}
          aria-hidden="true"
        />
      )}
      <code title={identity}>{identity}</code>
      <span className="sr-only" role="status">
        {t(`phase.${session.phase}`)}
      </span>
      {(session.exitCode !== null || session.exitSignal) && (
        <span className="terminal-session-notice">
          {session.exitCode !== null
            ? `${t("exitCode")}: ${session.exitCode}`
            : ""}
          {session.exitSignal ? ` · ${session.exitSignal}` : ""}
        </span>
      )}
      {session.error && (
        <span
          className="terminal-session-notice text-destructive"
          title={t(`error.${session.error}`)}
        >
          {t(
            session.error === "remoteUnknown"
              ? "remoteUnknownShort"
              : `error.${session.error}`,
          )}
        </span>
      )}
      {session.finishedAt !== null && (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={retry}
          title={retry}
          disabled={busy}
          onClick={reconnect}
        >
          <RotateCwIcon aria-hidden="true" />
        </Button>
      )}
      {closeButton}
    </div>
  );
}
