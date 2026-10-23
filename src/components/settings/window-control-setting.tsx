import {
  AppleIcon,
  MonitorIcon,
  AppWindowIcon,
  LayoutGridIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  resolveWindowControlPosition,
  resolveWindowControlStyle,
  type WindowControlPosition,
  type WindowControlStyle,
  useWindowControlSettingsStore,
} from "@/stores/window-control-settings-store"

export function WindowControlStyleSetting() {
  const { t } = useTranslation()
  const style = useWindowControlSettingsStore((state) => state.style)
  const setStyle = useWindowControlSettingsStore((state) => state.setStyle)
  const choices = [
    { value: "system", label: t("windowControls.styles.system"), icon: MonitorIcon },
    { value: "macos", label: t("windowControls.styles.macos"), icon: AppleIcon },
    { value: "windows", label: t("windowControls.styles.windows"), icon: LayoutGridIcon },
  ] as const

  return (
    <Tabs value={style} onValueChange={(value) => setStyle(value as WindowControlStyle)}>
      <TabsList className="h-8 p-0">
        {choices.map(({ value, label, icon: Icon }) => (
          <TabsTrigger
            key={value}
            value={value}
            aria-label={label}
            title={label}
            className="px-2"
          >
            <Icon aria-hidden="true" />
            <span className="hidden sm:inline">{label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

export function WindowControlPositionSetting() {
  const { t } = useTranslation()
  const position = useWindowControlSettingsStore((state) => state.position)
  const style = useWindowControlSettingsStore((state) => state.style)
  const setPosition = useWindowControlSettingsStore((state) => state.setPosition)
  const resolvedStyle = resolveWindowControlStyle(style)
  const displayedPosition = resolveWindowControlPosition(style, position, resolvedStyle)
  const followsSystem = style === "system"
  const choices = [
    { value: "left", label: t("windowControls.positions.left"), icon: AppWindowIcon },
    { value: "right", label: t("windowControls.positions.right"), icon: AppWindowIcon },
  ] as const

  return (
    <Tabs
      value={displayedPosition}
      onValueChange={(value) => setPosition(value as WindowControlPosition)}
    >
      <TabsList className="h-8 p-0">
        {choices.map(({ value, label, icon: Icon }) => (
          <TabsTrigger
            key={value}
            value={value}
            aria-label={label}
            title={label}
            disabled={followsSystem}
            className="px-2"
          >
            <Icon
              aria-hidden="true"
              className={value === "right" ? "-scale-x-100" : undefined}
            />
            <span>{label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
