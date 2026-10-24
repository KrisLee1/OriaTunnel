import { useTranslation } from "react-i18next";
import { Modal, ModalActions } from "@/components/tunnel-form";
import { Button } from "@/components/ui/button";
import type { RemoteService, ImportServicePreview } from "@/types";
import { reviewScript } from "./command-model";
type ReviewService =
  | Pick<RemoteService, "name" | "actions" | "control" | "noLocalEnvironment">
  | ImportServicePreview;

export function ServiceReview({
  service,
  endpoint,
}: {
  service: ReviewService;
  endpoint: string;
}) {
  const { t } = useTranslation("commands");
  const control = service.control;
  const seconds = (count: number) => t("review.seconds", { count });
  const codes = (values: number[]) => values.join(", ") || "—";
  const row = (label: string, value: string) => (
    <div key={label}>
      <dt>{label}</dt>
      <dd>{reviewScript(value)}</dd>
    </div>
  );
  const actionName = (id?: string | null) =>
    service.actions.find((action) => action.id === id)?.label ||
    t("service.disabled");
  return (
    <div className="service-review">
      <header className="service-review-heading">
        <strong>{reviewScript(service.name)}</strong>
        <span className="muted">{reviewScript(endpoint)}</span>
        <span className="muted">
          {t(
            service.noLocalEnvironment
              ? "review.localEnvOff"
              : "sharing.environmentDefault",
          )}
        </span>
      </header>
      <div className="service-review-commands">
        {service.actions.map((action, index) => (
          <details
            className="service-review-command"
            key={action.id}
            open={index === 0}
          >
            <summary>
              <span className="service-review-action-name">
                {reviewScript(action.label)}
              </span>
              <span className="source-badge">
                {t(
                  action.mode === "terminal" ? "modeTerminal" : "modeCommand",
                  { ns: "terminal" },
                )}
              </span>
            </summary>
            <div className="service-review-command-body">
              <dl className="service-review-meta">
                {row(
                  t("review.timeout"),
                  action.mode === "terminal" && action.timeoutSecs === 0
                    ? t("review.unlimited")
                    : seconds(action.timeoutSecs),
                )}
                {row(t("review.successCodes"), codes(action.successCodes))}
                {row(
                  t("review.confirm"),
                  t(action.confirm ? "sharing.yes" : "sharing.no"),
                )}
              </dl>
              <pre className="preset-script" data-selectable="true">
                {reviewScript(action.command)}
              </pre>
            </div>
          </details>
        ))}
      </div>
      {control && (
        <details className="service-review-command service-review-settings">
          <summary>{t("service.checks")}</summary>
          <div className="service-review-command-body">
            <dl className="service-review-definition">
              {row(
                t("service.statusAction"),
                actionName(control.statusProbe?.actionId),
              )}
              {control.statusProbe &&
                row(
                  t("service.mapping"),
                  t(`service.mappingMode.${control.statusProbe.mode}`),
                )}
              {control.statusProbe?.mode === "exitCode" && (
                <>
                  {row(
                    t("service.runningCodes"),
                    codes(control.statusProbe.runningCodes),
                  )}
                  {row(
                    t("service.stoppedCodes"),
                    codes(control.statusProbe.stoppedCodes),
                  )}
                  {row(
                    t("service.failedCodes"),
                    codes(control.statusProbe.failedCodes),
                  )}
                </>
              )}
              {row(t("service.startAction"), actionName(control.startActionId))}
              {row(
                t("service.checkAfter"),
                t(control.checkAfterActions ? "sharing.yes" : "sharing.no"),
              )}
              {row(t("review.ttl"), seconds(control.ttlSecs))}
            </dl>
            {control.healthProbe && (
              <section className="service-review-health">
                <h4>{t("service.healthCommand")}</h4>
                <pre className="preset-script" data-selectable="true">
                  {reviewScript(control.healthProbe.command)}
                </pre>
                <dl className="service-review-definition">
                  {row(
                    t("service.readyCodes"),
                    codes(control.healthProbe.readyCodes),
                  )}
                  {row(
                    t("service.notReadyCodes"),
                    codes(control.healthProbe.notReadyCodes),
                  )}
                  {row(
                    t("review.timeout"),
                    seconds(control.healthProbe.timeoutSecs),
                  )}
                  {row(
                    t("service.repeatable"),
                    t(
                      control.healthProbe.repeatable
                        ? "sharing.yes"
                        : "sharing.no",
                    ),
                  )}
                  {row(
                    t("service.interval"),
                    seconds(control.healthProbe.intervalSecs),
                  )}
                  {row(
                    t("service.budget"),
                    seconds(control.healthProbe.budgetSecs),
                  )}
                </dl>
              </section>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

export function ServiceEnableDialog({
  service,
  endpoint,
  busy,
  error,
  close,
  enable,
}: {
  service: RemoteService;
  endpoint: string;
  busy: boolean;
  error: string;
  close: () => void;
  enable: () => void;
}) {
  const { t } = useTranslation("commands");
  return (
    <Modal
      title={t("review.enableTitle")}
      description={t("review.enableHint")}
      close={() => {
        if (!busy) close();
      }}
      className="max-w-3xl sm:max-w-3xl"
    >
      <ServiceReview service={service} endpoint={endpoint} />
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <ModalActions>
        <Button type="button" variant="ghost" disabled={busy} onClick={close}>
          {t("cancel")}
        </Button>
        <Button
          type="button"
          variant="primary-soft"
          disabled={busy}
          onClick={enable}
        >
          {t("sharing.enable")}
        </Button>
      </ModalActions>
    </Modal>
  );
}
