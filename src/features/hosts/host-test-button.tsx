import { useEffect, useRef, useState } from "react";
import { CheckIcon, LoaderCircleIcon, PlayIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { Runtime } from "@/types";

export function HostTestButton({
  hostName,
  runtime,
  disabled,
  onTest,
  onStop,
}: {
  hostName: string;
  runtime?: Runtime;
  disabled: boolean;
  onTest: () => void;
  onStop: () => void;
}) {
  const { t } = useTranslation("tunnel");
  const runId = runtime?.runId;
  const status = runtime?.status;
  const previous = useRef({ runId, status });
  const [successRun, setSuccessRun] = useState<string | null>(null);
  const testing =
    !!status &&
    !["tested", "failed", "stopped", "needs-attention"].includes(status);
  const success = status === "tested" && !!runId && successRun === runId;

  useEffect(() => {
    const changed =
      previous.current.runId !== runId || previous.current.status !== status;
    previous.current = { runId, status };
    if (!changed || status !== "tested" || !runId) return;
    // Only dismiss feedback here; the Rust runtime remains the source of truth.
    setSuccessRun(runId);
    const timer = window.setTimeout(() => setSuccessRun(null), 2000);
    return () => window.clearTimeout(timer);
  }, [runId, status]);

  const label = t(
    testing
      ? "testingConnection"
      : success
        ? "testSucceeded"
        : "testConnection",
  );
  return (
    <Button
      size="sm"
      variant="primary-soft"
      className={`host-test-button${success ? " host-test-succeeded" : ""}`}
      disabled={disabled}
      aria-busy={testing}
      aria-label={`${label} ${hostName}`}
      title={testing ? t("stopTestHint") : label}
      onClick={() => {
        if (testing) onStop();
        else {
          setSuccessRun(null);
          onTest();
        }
      }}
    >
      {testing ? (
        <LoaderCircleIcon
          className="animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : success ? (
        <CheckIcon aria-hidden="true" />
      ) : (
        <PlayIcon aria-hidden="true" />
      )}
      <span aria-live="polite">{label}</span>
    </Button>
  );
}
