import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import {
  resources,
  resolveLanguage,
  supportedLanguages,
} from "./i18n-resources";

const languageStorageKey = "oria-tunnel-language";
function storedLanguage() {
  try {
    return typeof window === "undefined"
      ? null
      : window.localStorage.getItem(languageStorageKey);
  } catch {
    return null;
  }
}
const initialLanguage = resolveLanguage(storedLanguage());

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: "en",
  supportedLngs: supportedLanguages,
  load: "currentOnly",
  defaultNS: "common",
  returnEmptyString: false,
  interpolation: { escapeValue: false },
});

function applyLanguage(language: string) {
  const resolved = resolveLanguage(language);
  if (typeof document !== "undefined") document.documentElement.lang = resolved;
  try {
    if (typeof window !== "undefined")
      window.localStorage.setItem(languageStorageKey, resolved);
  } catch {
    // A blocked preferences store must not prevent a language change.
  }
}
applyLanguage(initialLanguage);
i18n.on("languageChanged", applyLanguage);

export default i18n;
