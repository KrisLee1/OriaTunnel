import { Undo2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function UndoDeleteButton({
  count,
  disabled,
  onClick,
}: {
  count: number;
  disabled: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation("tunnel");
  if (!count) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
    >
      <Undo2Icon aria-hidden="true" />
      {t("undoDelete")}
      <span className="rule-export-count">{count}</span>
    </Button>
  );
}
