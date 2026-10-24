import { useId, useState } from "react";
import { AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { Progress, ProgressValue } from "@/components/ui/progress";
import { Modal, ModalActions } from "@/components/tunnel-form";
import { desktop } from "@/lib/bridge";
import type { useApplicationUpdate } from "@/lib/application-update";
import { bytes } from "@/features/tunnels/runtime-format";

export function ApplicationUpdateSetting({
  updates,
  showVersion = true,
}: {
  updates: ReturnType<typeof useApplicationUpdate>;
  showVersion?: boolean;
}) {
  const { t, i18n } = useTranslation("updater");
  const autoId = useId();
  const [confirmation, setConfirmation] = useState<{
    version: string;
    ids: string[];
  } | null>(null);
  const state = updates.snapshot;
  const phase = state?.phase || "idle";
  const busy =
    updates.pending ||
    [
      "checking",
      "downloading",
      "verifying",
      "preparing",
      "installing",
    ].includes(phase);
  const installing = phase === "preparing" || phase === "installing";
  const unavailable = !desktop ? "browser" : state?.unavailable;
  const total = state?.total && state.total > 0 ? state.total : undefined;
  const showProgress = phase === "downloading" || phase === "verifying";
  const primaryAction =
    installing || state?.canInstall
      ? "install"
      : showProgress || state?.canDownload
        ? "download"
        : "check";
  const runPrimaryAction = async () => {
    const version = state?.release?.version;
    if (primaryAction === "install" && version) {
      const ids = await updates.context();
      if (ids) setConfirmation({ version, ids });
    } else if (primaryAction === "download" && version) {
      await updates.download(version);
    } else {
      await (state ? updates.check() : updates.refresh());
    }
  };
  const status = unavailable
    ? t(`unavailable.${unavailable}`)
    : !state
      ? t("loading")
      : phase === "idle"
        ? t("currentVersion", { version: state.currentVersion })
        : phase === "available"
          ? state.release && t("newVersion", { version: state.release.version })
          : t(`phase.${phase}`);
  return (
    <>
      <h3>{t("title")}</h3>
      <ItemGroup className="settings-section-panel themed-surface gap-0 divide-y divide-border-strong/15 overflow-hidden rounded-xl">
        <Item className="rounded-none border-0 px-3 py-2.5">
          <ItemContent className="min-w-0">
            {showVersion && phase !== "idle" && (
              <ItemDescription className="line-clamp-none">
                {t("currentVersion", { version: state?.currentVersion || "—" })}
              </ItemDescription>
            )}
            <ItemTitle
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="line-clamp-none w-auto"
            >
              {status}
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <Button
              size="sm"
              variant={primaryAction === "install" ? "default" : "outline"}
              disabled={busy || !!unavailable}
              onClick={() => void runPrimaryAction()}
            >
              {t(primaryAction)}
            </Button>
          </ItemActions>
          {(state?.error || updates.error || state?.preferenceError) && (
            <div className="basis-full text-xs text-destructive" role="alert">
              {state?.error && <p>{t(`errors.${state.error}`)}</p>}
              {updates.error && <p>{t(`errors.${updates.error}`)}</p>}
              {state?.preferenceError && <p>{t("errors.preferences")}</p>}
            </div>
          )}
          {showProgress && (
            <div className="grid basis-full gap-1">
              <Progress
                aria-label={t("progress")}
                aria-valuetext={!total ? t(`phase.${phase}`) : undefined}
                locale={i18n.resolvedLanguage}
                className="gap-1"
                max={total || 1}
                value={
                  total ? Math.min(state?.downloaded || 0, total) : null
                }
              >
                <div
                  className="order-last flex w-full items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums"
                  aria-live="off"
                >
                  <span>
                    {bytes(state?.downloaded || 0)}
                    {total ? ` / ${bytes(total)}` : ""}
                  </span>
                  {total && <ProgressValue />}
                </div>
              </Progress>
            </div>
          )}
          {state?.release && (state.release.notes || phase !== "available") && (
            <div className="grid min-w-0 basis-full gap-2 text-sm">
              {phase !== "available" && (
                <p>{t("newVersion", { version: state.release.version })}</p>
              )}
              {state.release.notes && (
                <details>
                  <summary className="cursor-pointer text-xs">
                    {t("notes")}
                  </summary>
                  <p
                    className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground"
                    data-selectable="true"
                  >
                    {state.release.notes}
                  </p>
                </details>
              )}
            </div>
          )}
        </Item>
        <Item className="rounded-none border-0 px-3 py-2.5">
          <ItemContent className="min-w-0">
            <ItemTitle>
              <label htmlFor={autoId}>{t("autoCheck")}</label>
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <Switch
              id={autoId}
              checked={state?.autoCheck ?? false}
              disabled={!desktop || !state || busy}
              onCheckedChange={(enabled) => void updates.autoCheck(enabled)}
            />
          </ItemActions>
        </Item>
        <Item className="justify-end rounded-none border-0 px-3 py-2.5">
          <ExternalLink
            href="https://github.com/KrisLee1/OriaTunnel/releases"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t("releases")}
          </ExternalLink>
        </Item>
      </ItemGroup>
      <AnimatePresence>
        {confirmation && (
          <Modal
            key="install-update"
            title={t("confirmTitle")}
            close={() => {
              if (!busy) setConfirmation(null);
            }}
          >
            <p>{t("confirmHint", { version: confirmation.version })}</p>
            <p>
              {t("activeForwards", {
                count: confirmation.ids.filter(
                  (id) => !id.startsWith("host-test:"),
                ).length,
              })}
            </p>
            <p>
              {t("activeTests", {
                count: confirmation.ids.filter((id) =>
                  id.startsWith("host-test:"),
                ).length,
              })}
            </p>
            <ModalActions>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmation(null)}
              >
                {t("later")}
              </Button>
              <Button
                variant="destructive"
                disabled={
                  busy ||
                  !state?.canInstall ||
                  state.release?.version !== confirmation.version
                }
                onClick={async () => {
                  await updates.install(confirmation.version, confirmation.ids);
                  setConfirmation(null);
                }}
              >
                {installing ? t(`phase.${phase}`) : t("confirmInstall")}
              </Button>
            </ModalActions>
          </Modal>
        )}
      </AnimatePresence>
    </>
  );
}
