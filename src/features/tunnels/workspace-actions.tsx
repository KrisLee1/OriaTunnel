import { PlayIcon, SquareIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function WorkspaceActions({
  count,
  busy,
  available,
  onStartAll,
  onStopAll,
}: {
  count: number;
  busy: boolean;
  available: boolean;
  onStartAll: () => void;
  onStopAll: () => void;
}) {
  const { t } = useTranslation("tunnel");
  const disabled = !available || busy || count === 0;
  return (
    <>
      <Button
        variant="primary-soft"
        className="bg-transparent dark:bg-transparent"
        size="icon-sm"
        disabled={disabled}
        aria-label={t("startAll")}
        title={t("allRulesHint", { action: t("startAll"), count })}
        onClick={onStartAll}
      >
        <PlayIcon />
      </Button>
      <Button
        variant="destructive"
        className="bg-transparent dark:bg-transparent"
        size="icon-sm"
        disabled={disabled}
        aria-label={t("stopAll")}
        title={t("allRulesHint", { action: t("stopAll"), count })}
        onClick={onStopAll}
      >
        <SquareIcon />
      </Button>
    </>
  );
}
