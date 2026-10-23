import { CircleDashed, MonitorIcon, MoonStarIcon, SunIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  saveApplicationIconPreference,
  useApplicationIconPreference,
} from "@/lib/application-icon"
import type { ApplicationIconPreference } from "@/types"

export function ApplicationIconSetting() {
  const { t } = useTranslation()
  const preference = useApplicationIconPreference()
  const choices = [
    { value: "system", label: t("applicationIcon.system"), icon: MonitorIcon },
    { value: "light", label: t("applicationIcon.light"), icon: SunIcon },
    { value: "dark", label: t("applicationIcon.dark"), icon: MoonStarIcon },
    { value: "mono", label: t("applicationIcon.mono"), icon: CircleDashed },
  ] as const

  return (
    <Tabs
      value={preference}
      onValueChange={(value) => saveApplicationIconPreference(value as ApplicationIconPreference)}
    >
      <TabsList variant="soft">
        {choices.map(({ value, label, icon: Icon }) => (
          <TabsTrigger key={value} value={value} aria-label={label} title={label} className="px-2">
            <Icon aria-hidden="true" />
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
