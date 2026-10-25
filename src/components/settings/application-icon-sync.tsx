import { formatNativeMessage } from "@/lib/native-message";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/components/ui/toast";

import {
  applyApplicationIcon,
  useApplicationIconPreference,
} from "@/lib/application-icon";

export function ApplicationIconSync() {
  const { t } = useTranslation();
  const preference = useApplicationIconPreference();
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const updateColorScheme = (event: MediaQueryListEvent) =>
      setSystemPrefersDark(event.matches);
    colorScheme.addEventListener("change", updateColorScheme);
    return () => colorScheme.removeEventListener("change", updateColorScheme);
  }, []);

  useEffect(() => {
    let active = true;
    void applyApplicationIcon(preference, systemPrefersDark).catch(
      (error: unknown) => {
        if (active)
          toast.add({
            type: "error",
            title: t("applicationIcon.applyFailed"),
            description: formatNativeMessage(String(error)),
            timeout: 6000,
          });
      },
    );
    return () => {
      active = false;
    };
  }, [preference, systemPrefersDark, t]);

  return null;
}
