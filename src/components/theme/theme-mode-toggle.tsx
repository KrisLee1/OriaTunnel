import type { AppearanceMode } from "@oriatheme/core"
import { useOriaTheme } from "@oriatheme/react"
import { MonitorIcon, MoonStarIcon, SunIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  themeTransitionOptions,
  type ThemeTransitionEventDetails,
} from "@/components/theme/theme-transition"
import { cn } from "@/lib/utils"

interface ThemeModeToggleProps {
  variant?: "link" | "default" | "secondary" | "destructive" | "outline" | "ghost" | null
  size?: "default" | "sm" | "lg" | "icon" | null
  align?: "end" | "center" | "start"
  side?: "left" | "top" | "right" | "bottom"
  tooltip?: string
  className?: string
  displayMode?: "default" | "switch" | "icon" | null
}

export function ThemeModeToggle({ variant, size, align, side, tooltip, className, displayMode }: ThemeModeToggleProps) {
  const { snapshot, setAppearance } = useOriaTheme()
  const { t } = useTranslation()
  const items = [
    { value: "system", icon: <MonitorIcon />, label: t("appAppearance.system") },
    { value: "light", icon: <SunIcon />, label: t("appAppearance.light") },
    { value: "dark", icon: <MoonStarIcon />, label: t("appAppearance.dark") },
  ] as const
  const mode = snapshot.preference.appearance
  const resolvedMode = snapshot.resolvedMode
  const CurrentModeIcon = mode === "system" ? MonitorIcon : resolvedMode === "dark" ? MoonStarIcon : SunIcon
  const changeMode = (
    value: string,
    eventDetails: ThemeTransitionEventDetails,
  ) => setAppearance(value as AppearanceMode, themeTransitionOptions(eventDetails))

  if (displayMode === "switch") {
    return (
      <Tabs value={resolvedMode} onValueChange={changeMode}>
        <TabsList className={cn("p-0", className)}>
          {items.slice(1).map((item) => <TabsTrigger key={item.value} value={item.value} aria-label={item.label} title={item.label} className="aspect-square">{item.icon}</TabsTrigger>)}
        </TabsList>
      </Tabs>
    )
  }

  if (displayMode === "icon") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={tooltip || t("appAppearance.label")} title={tooltip} className={cn(buttonVariants({ variant, size, className }))}>
          <CurrentModeIcon className="size-4" aria-hidden="true" />
          <span className="sr-only">{t("appAppearance.label")}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} side={side}>
          <DropdownMenuRadioGroup value={mode} onValueChange={changeMode}>
            {items.map((item) => <DropdownMenuRadioItem key={item.value} value={item.value}>{item.icon}{item.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <Tabs value={mode} onValueChange={changeMode}>
      <TabsList className={cn(className)}>
        {items.map((item) => <TabsTrigger value={item.value} key={item.value} aria-label={item.label} title={item.label} className="aspect-square">{item.icon}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  )
}
