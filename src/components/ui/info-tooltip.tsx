import { useState } from "react";
import { CircleAlert, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function InfoTooltip({
  description,
  label,
  icon: Icon = CircleAlert,
}: {
  description: string;
  label: string;
  icon?: LucideIcon;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);

  return (
    <Tooltip
      open={open}
      onOpenChange={(next, details) => {
        if (
          pinned &&
          (details.reason === "trigger-hover" ||
            details.reason === "trigger-focus")
        )
          return;
        setOpen(next);
        if (!next) setPinned(false);
      }}
    >
      <TooltipTrigger
        type="button"
        closeOnClick={false}
        onClick={() => {
          setPinned(!pinned);
          setOpen(!pinned);
        }}
        aria-label={`${label} · ${t("settings.showDescription")}`}
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 outline-none transition-[color,transform] duration-aide-fast hover:text-foreground active:scale-90 focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-left leading-5">
        {description}
      </TooltipContent>
    </Tooltip>
  );
}
