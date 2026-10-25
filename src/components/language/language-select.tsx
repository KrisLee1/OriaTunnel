import { LanguagesIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const languageList = [
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "ru", label: "Русский" },
];

export function LanguageSelect({
  className,
  variant,
  size,
  displayMode,
  align,
  side,
  tooltip,
}: {
  className?: string;
  variant?:
    | "link"
    | "default"
    | "secondary"
    | "destructive"
    | "outline"
    | "ghost"
    | null;
  size?: "default" | "sm" | "lg" | null;
  displayMode?: "default" | "icon" | "label" | "code" | "icon-code" | null;
  align?: "end" | "center" | "start";
  side?: "left" | "top" | "right" | "bottom";
  tooltip?: string;
}) {
  const { i18n } = useTranslation();
  const changeLanguage = (lang: string) => {
    void i18n.changeLanguage(lang);
  };
  const selectedLanguage =
    languageList.find((lang) => lang.code === i18n.language) ??
    languageList.find((lang) => i18n.language.startsWith(`${lang.code}-`)) ??
    languageList[0];
  const items = languageList.map((item) => ({
    label: item.label,
    value: item.code,
  }));

  return (
    <Select
      items={items}
      value={selectedLanguage.code}
      onValueChange={(lang) => changeLanguage(lang || "zh-CN")}
    >
      <SelectTrigger
        title={tooltip}
        className={cn(buttonVariants({ variant, size, className }))}
      >
        <SelectValue
          render={(props) => (
            <span {...props}>
              {displayMode !== "label" && displayMode !== "code" && (
                <LanguagesIcon />
              )}
              {(displayMode === "code" || displayMode === "icon-code") && (
                <span>{selectedLanguage.code}</span>
              )}
              {displayMode !== "icon" &&
                displayMode !== "code" &&
                displayMode !== "icon-code" &&
                props.children}
            </span>
          )}
        />
      </SelectTrigger>
      <SelectContent
        align={align}
        side={side}
        className="w-fit"
        alignItemWithTrigger
      >
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
