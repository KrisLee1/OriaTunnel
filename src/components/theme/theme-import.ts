import { importTheme, oriaStandardContract, type ImportResult, type ThemeDefinition } from "@oriatheme/core"

export const MAX_THEME_FILE_BYTES = 128 * 1024
export const MAX_CUSTOM_THEME_COUNT = 50

function nameHash(name: string) {
  let hash = 2166136261
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function baseThemeId(name: string) {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  if (!slug) return `theme-${nameHash(name)}`
  const prefixed = /^[a-z]/.test(slug) && slug.length > 1 ? slug : `theme-${slug}`
  return prefixed.slice(0, 64).replace(/-+$/g, "")
}

export function generateCustomThemeId(name: string, existingIds: readonly string[]) {
  const base = baseThemeId(name)
  const used = new Set(existingIds)
  if (!used.has(base)) return base

  let suffix = 2
  while (true) {
    const ending = `-${suffix}`
    const candidate = `${base.slice(0, 64 - ending.length).replace(/-+$/g, "")}${ending}`
    if (!used.has(candidate)) return candidate
    suffix += 1
  }
}

export function parseImportedTheme(json: string): ImportResult {
  return importTheme(json, {
    contract: oriaStandardContract,
    maxBytes: MAX_THEME_FILE_BYTES,
  })
}

export function renameImportedTheme(
  theme: ThemeDefinition,
  name: string,
  id: string,
  now = Date.now(),
): ThemeDefinition {
  return {
    ...theme,
    id,
    name: name.trim(),
    kind: "custom",
    createdAt: now,
    updatedAt: now,
  }
}
