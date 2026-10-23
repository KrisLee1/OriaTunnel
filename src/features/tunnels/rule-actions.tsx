import type { ReactNode } from "react";
import {
  CopyPlusIcon,
  InfoIcon,
  Settings2Icon,
  Trash2Icon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { Rule } from "@/types";

export function RuleActions({
  rule,
  onDetails,
  onEdit,
  onCopy,
  onDelete,
  children,
}: {
  rule: Rule;
  onDetails: (rule: Rule) => void;
  onEdit: (rule: Rule) => void;
  onCopy: (rule: Rule) => void;
  onDelete: (rule: Rule) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation("tunnel");
  return (
    <div
      className="rule-actions nodrag nopan"
      role="group"
      aria-label={`${t("forwardActions")} ${rule.name}`}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`${t("details")} ${rule.name}`}
        title={t("details")}
        aria-haspopup="dialog"
        onClick={() => onDetails(rule)}
      >
        <InfoIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`${t("edit")} ${rule.name}`}
        title={t("edit")}
        aria-haspopup="dialog"
        onClick={() => onEdit(rule)}
      >
        <Settings2Icon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`${t("copyRule")} ${rule.name}`}
        title={t("copyRule")}
        aria-haspopup="dialog"
        onClick={() => onCopy(rule)}
      >
        <CopyPlusIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`${t("delete")} ${rule.name}`}
        title={t("delete")}
        aria-haspopup="dialog"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20"
        onClick={() => onDelete(rule)}
      >
        <Trash2Icon />
      </Button>
      {children}
    </div>
  );
}
