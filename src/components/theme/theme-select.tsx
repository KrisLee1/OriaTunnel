import type { ResolvedMode, ThemeDefinition, TokenPath } from "@oriatheme/core"
import { useOriaTheme } from "@oriatheme/react"
import { useTranslation } from "react-i18next"

import { AIDE_THEME_OPTIONS } from "@/components/theme/aide-theme-provider"
import { themeTransitionOptions } from "@/components/theme/theme-transition"
import { buttonVariants } from "@/components/ui/button"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

const themePalettePaths = ["color.primary", "color.secondary", "color.accent", "color.selection", "color.info"] as const

export function ThemePaletteIcon({ theme, mode }: { theme: ThemeDefinition; mode: ResolvedMode }) {
  return <span className="aide-theme-palette" aria-hidden="true">{themePalettePaths.map((path) => {
    const color = theme.modes[mode][path as TokenPath]
    return <i key={path} style={{ backgroundColor: typeof color === "string" ? color : "transparent" }} />
  })}</span>
}

export function ThemeSelect({ className, variant, size, displayMode, align, side, tooltip }: {
  className?: string
  variant?: "link" | "default" | "secondary" | "destructive" | "outline" | "ghost" | null
  size?: "default" | "sm" | "lg" | null
  displayMode?: "default" | "icon" | "label" | null
  align?: "end" | "center" | "start"
  side?: "left" | "top" | "right" | "bottom"
  tooltip?: string
}) {
  const { snapshot, setTheme } = useOriaTheme()
  const { t } = useTranslation()
  const customThemeOptions = snapshot.customThemes.map((theme) => ({
    id: theme.id,
    name: theme.name,
    theme,
  }))
  const allThemeOptions = [...customThemeOptions, ...AIDE_THEME_OPTIONS]
  const selectedTheme = allThemeOptions.find((option) => option.id === snapshot.preference.activeThemeId) ?? AIDE_THEME_OPTIONS[0]
  const items = allThemeOptions.map((item) => ({ label: item.name, value: item.id }))

  return (
    <Select
      items={items}
      value={selectedTheme.id}
      onValueChange={(themeId, eventDetails) => setTheme(
        themeId || AIDE_THEME_OPTIONS[0].id,
        themeTransitionOptions(eventDetails),
      )}
    >
      <SelectTrigger title={tooltip} className={cn(buttonVariants({ variant, size, className }))}>
        <SelectValue render={(props) => <span {...props}>
          {displayMode !== "label" && <ThemePaletteIcon theme={selectedTheme.theme} mode={snapshot.resolvedMode} />}
          {displayMode !== "icon" && props.children}
        </span>} />
      </SelectTrigger>
      <SelectContent align={align} side={side} className="w-fit max-h-[min(28rem,var(--available-height))]" alignItemWithTrigger>
        {customThemeOptions.length > 0 && (
          <SelectGroup>
            <SelectLabel>{t("theme.customThemes")}</SelectLabel>
            {customThemeOptions.map((option) => <SelectItem key={option.id} value={option.id}><ThemePaletteIcon theme={option.theme} mode={snapshot.resolvedMode} />{option.name}</SelectItem>)}
          </SelectGroup>
        )}
        <SelectGroup>
          <SelectLabel>{t("theme.presetThemes")}</SelectLabel>
          {AIDE_THEME_OPTIONS.map((option) => <SelectItem key={option.id} value={option.id}><ThemePaletteIcon theme={option.theme} mode={snapshot.resolvedMode} />{option.name}</SelectItem>)}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
