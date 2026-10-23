import { useTranslation } from "react-i18next";
import type { Rule, Runtime } from "@/types";
import { rulePath } from "./rule-model";
import { bytes, duration, rate } from "./runtime-format";
import { runtimeStatus } from "./runtime-status";
export function RuntimeDetails({
  rule,
  runtime,
  hostName,
}: {
  rule: Rule;
  runtime?: Runtime;
  hostName: string;
}) {
  const { t } = useTranslation("tunnel");
  const history = runtime?.history || [];
  const hasTraffic = history.some(
    (sample) => sample.sentPerSecond > 0 || sample.receivedPerSecond > 0,
  );
  const max = Math.max(
    1,
    ...history.flatMap((p) => [p.sentPerSecond, p.receivedPerSecond]),
  );
  const points = (field: "sentPerSecond" | "receivedPerSecond") =>
    history
      .map(
        (p, i) =>
          `${(i * 300) / Math.max(1, history.length - 1)},${70 - (p[field] / max) * 65}`,
      )
      .join(" ");
  const health = runtime?.targetHealth;
  return (
    <div className="runtime-details">
      <code className="path-preview">
        {rulePath(rule, hostName, t("local"))}
      </code>
      <dl className="runtime-grid">
        <div>
          <dt>{t("actualState")}</dt>
          <dd>{t(runtimeStatus(runtime).label)}</dd>
        </div>
        <div>
          <dt>{t("desiredState")}</dt>
          <dd>{t(runtime?.desiredRunning ? "active" : "stopped")}</dd>
        </div>
        <div>
          <dt>{t("sessionTime")}</dt>
          <dd>
            {duration(runtime?.uptimeSecs, [
              t("unitDays"),
              t("unitHours"),
              t("unitMinutes"),
              t("unitSeconds"),
            ])}
          </dd>
        </div>
        <div>
          <dt>{t("connections")}</dt>
          <dd>{runtime?.connections ?? "—"}</dd>
        </div>
        <div>
          <dt>{t("sent")}</dt>
          <dd>
            {bytes(runtime?.sent)} · {rate(runtime?.sentPerSecond)}
          </dd>
        </div>
        <div>
          <dt>{t("received")}</dt>
          <dd>
            {bytes(runtime?.received)} · {rate(runtime?.receivedPerSecond)}
          </dd>
        </div>
        <div>
          <dt>{t("retryCount")}</dt>
          <dd>{runtime?.retryCount ?? "—"}</dd>
        </div>
        <div>
          <dt>{t("nextRetry")}</dt>
          <dd>
            {runtime?.retryAt
              ? new Date(runtime.retryAt).toLocaleTimeString()
              : "—"}
          </dd>
        </div>
        <div>
          <dt>{t("targetHealth")}</dt>
          <dd>{t(health?.state || "unknown")}</dd>
        </div>
        <div>
          <dt>{t("evidence")}</dt>
          <dd>
            {health?.checkedAt
              ? `${t(health.side === "local" ? "local" : "remoteSide")} · TCP · ${new Date(health.checkedAt).toLocaleTimeString()}`
              : "—"}
          </dd>
        </div>
        <div>
          <dt>{t("authMethod")}</dt>
          <dd>
            {runtime?.authMethodUsed
              ? t(
                  {
                    auto: "authAuto",
                    password: "authPassword",
                    privateKey: "authPrivateKey",
                    agent: "authAgent",
                  }[runtime.authMethodUsed],
                )
              : "—"}
          </dd>
        </div>
        <div>
          <dt>{t("runId")}</dt>
          <dd>
            <code>{runtime?.runId || "—"}</code>
          </dd>
        </div>
      </dl>
      <p className="muted">
        {t(rule.kind === "D" ? "socksHealthHint" : "targetHealthHint")}
      </p>
      {runtime?.errorKind && (
        <p className="inline-error">{t(`failure-${runtime.errorKind}`)}</p>
      )}
      {runtime?.message && <p className="muted">{runtime.message}</p>}
      {runtime?.configurationChanged && (
        <p className="inline-error">{t("configChanged")}</p>
      )}
      <section className="runtime-traffic">
        <h3>{t("trafficWindow")}</h3>
        {history.length > 1 && hasTraffic ? (
          <svg
            className="traffic-chart"
            viewBox="0 0 300 75"
            role="img"
            aria-label={t("trafficWindow")}
            preserveAspectRatio="none"
          >
            <polyline
              fill="none"
              stroke="var(--oria-color-accent)"
              strokeWidth="1.25"
              vectorEffect="non-scaling-stroke"
              points={points("sentPerSecond")}
            >
              <title>{t("sent")}</title>
            </polyline>
            <polyline
              fill="none"
              stroke="var(--oria-color-muted-fg)"
              strokeWidth="1.25"
              vectorEffect="non-scaling-stroke"
              points={points("receivedPerSecond")}
            >
              <title>{t("received")}</title>
            </polyline>
          </svg>
        ) : (
          <p className="muted">
            {t(history.length > 1 ? "noRecentTraffic" : "unmeasured")}
          </p>
        )}
      </section>
    </div>
  );
}
