import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { Modal, ModalActions } from "@/components/tunnel-form";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { desktop } from "@/lib/bridge";
import { InitialPreferenceSettings } from "./appearance-settings";

export const FIRST_USE_PREFERENCES_KEY = "oria-tunnel.initial-preferences.v1";

export function firstUsePreferencesCompleted(
  storage: Pick<Storage, "getItem"> | undefined,
): boolean {
  try {
    return storage?.getItem(FIRST_USE_PREFERENCES_KEY) === "completed";
  } catch {
    return false;
  }
}

function completed() {
  try {
    return firstUsePreferencesCompleted(window.localStorage);
  } catch {
    return false;
  }
}

export function FirstUsePreferences({ ready }: { ready: boolean }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(() => !completed());
  const finish = () => {
    try {
      window.localStorage.setItem(FIRST_USE_PREFERENCES_KEY, "completed");
    } catch {
      toast.add({ type: "error", title: t("initialPreferences.saveFailed") });
    }
    setPending(false);
  };
  return (
    <AnimatePresence>
      {desktop && ready && pending && (
        <Modal
          title={t("initialPreferences.title")}
          description={t("initialPreferences.description")}
          close={finish}
          className="max-w-xl sm:max-w-xl"
        >
          <InitialPreferenceSettings />
          <ModalActions>
            <Button variant="primary-soft" onClick={finish}>
              {t("initialPreferences.done")}
            </Button>
          </ModalActions>
        </Modal>
      )}
    </AnimatePresence>
  );
}
