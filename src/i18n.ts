import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import de from "@/public/locales/de/common.json"
import en from "@/public/locales/en/common.json"
import fr from "@/public/locales/fr/common.json"
import ja from "@/public/locales/ja/common.json"
import ko from "@/public/locales/ko/common.json"
import ru from "@/public/locales/ru/common.json"
import zhCN from "@/public/locales/zh-CN/common.json"
import zhTW from "@/public/locales/zh-TW/common.json"
import updateDe from "@/public/locales/de/updater.json"
import updateEn from "@/public/locales/en/updater.json"
import updateFr from "@/public/locales/fr/updater.json"
import updateJa from "@/public/locales/ja/updater.json"
import updateKo from "@/public/locales/ko/updater.json"
import updateRu from "@/public/locales/ru/updater.json"
import updateZhCN from "@/public/locales/zh-CN/updater.json"
import updateZhTW from "@/public/locales/zh-TW/updater.json"

const supportedLanguages = ["zh-CN", "zh-TW", "en", "ja", "ko", "de", "fr", "ru"] as const
type SupportedLanguage = (typeof supportedLanguages)[number]

const resources = {
  "zh-CN": { common: zhCN, updater: updateZhCN },
  "zh-TW": { common: zhTW, updater: updateZhTW },
  en: { common: en, updater: updateEn },
  ja: { common: ja, updater: updateJa },
  ko: { common: ko, updater: updateKo },
  de: { common: de, updater: updateDe },
  fr: { common: fr, updater: updateFr },
  ru: { common: ru, updater: updateRu },
}

function resolveInitialLanguage(value: string | null): SupportedLanguage {
  const normalized = value?.toLowerCase()
  if (normalized === "zh-tw" || normalized?.startsWith("zh-hk") || normalized?.startsWith("zh-mo")) {
    return "zh-TW"
  }
  if (normalized?.startsWith("zh")) return "zh-CN"
  if (normalized?.startsWith("en")) return "en"
  if (normalized?.startsWith("ja")) return "ja"
  if (normalized?.startsWith("ko")) return "ko"
  if (normalized?.startsWith("de")) return "de"
  if (normalized?.startsWith("fr")) return "fr"
  if (normalized?.startsWith("ru")) return "ru"
  return "zh-CN"
}

const storedLanguage =
  typeof window === "undefined" ? null : window.localStorage.getItem("oria-tunnel-language")
const initialLanguage = resolveInitialLanguage(storedLanguage)

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: "en",
  supportedLngs: supportedLanguages,
  defaultNS: "common",
  interpolation: { escapeValue: false },
})

if (typeof document !== "undefined") {
  document.documentElement.lang = i18n.resolvedLanguage || initialLanguage
}

i18n.on("languageChanged", (language) => {
  if (typeof document !== "undefined") document.documentElement.lang = language
})

export default i18n
