import type { Resource } from "i18next";

export const supportedLanguages = [
  "zh-CN",
  "zh-TW",
  "en",
  "ja",
  "ko",
  "de",
  "fr",
  "ru",
] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

// Bundle local resources eagerly: switching language never needs a network request.
const bundles = import.meta.glob("./public/locales/*/*.json", {
  eager: true,
  import: "default",
});
export const resources: Resource = {};
for (const [path, bundle] of Object.entries(bundles)) {
  const [, language, namespace] = path.match(
    /\/locales\/([^/]+)\/([^/]+)\.json$/,
  )!;
  if (!supportedLanguages.includes(language as SupportedLanguage)) continue;
  (resources[language] ??= {})[namespace] = bundle as Resource[string][string];
}

export function resolveLanguage(
  value: string | null | undefined,
): SupportedLanguage {
  const normalized = value?.replaceAll("_", "-").toLowerCase();
  if (normalized?.startsWith("zh")) {
    return /(?:^|-)hant(?:-|$)|^zh-(?:tw|hk|mo)(?:-|$)/.test(normalized)
      ? "zh-TW"
      : "zh-CN";
  }
  return (
    supportedLanguages.find(
      (code) => normalized === code || normalized?.startsWith(`${code}-`),
    ) ?? "zh-CN"
  );
}
