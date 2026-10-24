import terminalen from "@/public/locales/en/terminal.json"
import terminalzhCN from "@/public/locales/zh-CN/terminal.json"
import terminalzhTW from "@/public/locales/zh-TW/terminal.json"
import terminalja from "@/public/locales/ja/terminal.json"
import terminalko from "@/public/locales/ko/terminal.json"
import terminalde from "@/public/locales/de/terminal.json"
import terminalfr from "@/public/locales/fr/terminal.json"
import terminalru from "@/public/locales/ru/terminal.json"
import commanden from "@/public/locales/en/commands.json"
import commandzhCN from "@/public/locales/zh-CN/commands.json"
import commandzhTW from "@/public/locales/zh-TW/commands.json"
import commandja from "@/public/locales/ja/commands.json"
import commandko from "@/public/locales/ko/commands.json"
import commandde from "@/public/locales/de/commands.json"
import commandfr from "@/public/locales/fr/commands.json"
import commandru from "@/public/locales/ru/commands.json"
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
  "zh-CN": { common: zhCN, updater: updateZhCN, commands: commandzhCN, terminal: terminalzhCN },
  "zh-TW": { common: zhTW, updater: updateZhTW, commands: commandzhTW, terminal: terminalzhTW },
  en: { common: en, updater: updateEn, commands: commanden, terminal: terminalen },
  ja: { common: ja, updater: updateJa, commands: commandja, terminal: terminalja },
  ko: { common: ko, updater: updateKo, commands: commandko, terminal: terminalko },
  de: { common: de, updater: updateDe, commands: commandde, terminal: terminalde },
  fr: { common: fr, updater: updateFr, commands: commandfr, terminal: terminalfr },
  ru: { common: ru, updater: updateRu, commands: commandru, terminal: terminalru },
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
