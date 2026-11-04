import { useRef, useState } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";

export function FileSearchButton({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("files");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const focusOnOpen = useRef(false);
  return (
    <Popover
      modal={false}
      open={open}
      onOpenChange={(next, details) => {
        focusOnOpen.current = details.reason !== "trigger-hover";
        setOpen(next);
      }}
    >
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={150}
        disabled={disabled}
        onClick={() => input.current?.focus()}
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={`files-search-trigger ${value ? "bg-muted" : ""}`}
            data-filtered={!!value}
            aria-label={t("search")}
            title={value ? `${t("search")}: ${value}` : t("search")}
          >
            <Search />
          </Button>
        }
      />
      <PopoverContent
        align="end"
        className="files-search-popup files-options-popup"
        aria-label={t("search")}
        initialFocus={() => (focusOnOpen.current ? input.current : false)}
      >
        <SearchInput
          ref={input}
          aria-label={t("search")}
          placeholder={t("search")}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </PopoverContent>
    </Popover>
  );
}
