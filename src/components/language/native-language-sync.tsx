import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

// Serialize preference writes so fast language changes cannot finish out of order.
let pending = Promise.resolve();
export function NativeLanguageSync() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language;
  useEffect(() => {
    if (!isTauri()) return;
    pending = pending
      .catch(() => undefined)
      .then(() => invoke<void>("set_native_language", { language }));
    void pending.catch((error: unknown) =>
      console.error(
        "Native language preference could not be synchronized",
        error,
      ),
    );
  }, [language]);
  return null;
}
