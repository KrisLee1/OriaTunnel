import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react"
import { CheckCircle2, FileJson, Plus, Trash2, Upload } from "lucide-react"
import { useOriaTheme } from "@oriatheme/react"
import { useTranslation } from "react-i18next"

import {
  generateCustomThemeId,
  MAX_CUSTOM_THEME_COUNT,
  MAX_THEME_FILE_BYTES,
  parseImportedTheme,
  renameImportedTheme,
} from "@/components/theme/theme-import"
import { ThemePaletteIcon } from "@/components/theme/theme-select"
import { themeTransitionOptionsFromAnchor } from "@/components/theme/theme-transition"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalTrigger,
} from "@/components/ui/responsive-modal"
import { useNativeFileDrop } from "@/hooks/use-native-file-drop"
import { readNativeDroppedFile } from "@/lib/file-drop"
import { cn } from "@/lib/utils"
import type { ThemeDefinition } from "@oriatheme/core"

type ImportedFile = {
  fileName: string
  theme: ThemeDefinition
}

export function ThemeImportSetting() {
  const { snapshot, runtime, setTheme } = useOriaTheme()
  const { t } = useTranslation()
  const dropRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [importedFile, setImportedFile] = useState<ImportedFile | null>(null)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)

  function resetForm() {
    setDragging(false)
    setImportedFile(null)
    setName("")
    setError(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) resetForm()
  }

  async function loadFile(file: File) {
    setError(null)
    setImportedFile(null)

    if (!file.name.toLowerCase().endsWith(".json")) {
      setError(t("theme.import.errors.fileType"))
      return
    }
    if (file.size > MAX_THEME_FILE_BYTES) {
      setError(t("theme.import.errors.fileSize"))
      return
    }

    try {
      const json = await file.text()
      const result = parseImportedTheme(json)
      if (!result.ok) {
        const code = result.issues[0]?.code
        setError(t(code === "UNSUPPORTED_SCHEMA_VERSION" || code === "UNSUPPORTED_CONTRACT"
          ? "theme.import.errors.unsupported"
          : code === "INVALID_JSON"
            ? "theme.import.errors.invalidJson"
            : "theme.import.errors.invalidTheme"))
        return
      }
      setImportedFile({ fileName: file.name, theme: result.theme })
      setName(result.theme.name)
    } catch {
      setError(t("theme.import.errors.readFailed"))
    } finally {
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  useNativeFileDrop(dropRef, open, paths => {
    if (paths[0]) void readNativeDroppedFile(paths[0], MAX_THEME_FILE_BYTES, "application/json")
      .then(loadFile).catch(() => setError(t("theme.import.errors.readFailed")))
  }, setDragging)

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) void loadFile(file)
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) void loadFile(file)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    const normalizedName = name.trim()
    if (!importedFile) {
      setError(t("theme.import.errors.fileRequired"))
      return
    }
    if (!normalizedName) {
      setError(t("theme.import.errors.nameRequired"))
      return
    }
    if (normalizedName.length > 120) {
      setError(t("theme.import.errors.nameTooLong"))
      return
    }
    if (snapshot.customThemes.length >= MAX_CUSTOM_THEME_COUNT) {
      setError(t("theme.import.errors.limit", { count: MAX_CUSTOM_THEME_COUNT }))
      return
    }

    try {
      const existingIds = [...snapshot.presets, ...snapshot.customThemes].map((theme) => theme.id)
      const id = generateCustomThemeId(normalizedName, existingIds)
      const renamedTheme = renameImportedTheme(importedFile.theme, normalizedName, id)
      const addedTheme = runtime.importTheme(JSON.stringify(renamedTheme))
      setTheme(
        addedTheme.id,
        themeTransitionOptionsFromAnchor(
          submitter && "getBoundingClientRect" in submitter ? submitter : null,
        ),
      )
      handleOpenChange(false)
    } catch {
      setError(t("theme.import.errors.addFailed"))
    }
  }

  return (
    <ResponsiveModal open={open} onOpenChange={handleOpenChange}>
      <ResponsiveModalTrigger>
        <Button type="button" variant="outline" size="sm">
          <Plus aria-hidden="true" />
          {t("theme.import.add")}
        </Button>
      </ResponsiveModalTrigger>
      <ResponsiveModalContent className="max-h-[min(90dvh,34rem)] sm:max-w-md">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{t("theme.import.title")}</ResponsiveModalTitle>
        </ResponsiveModalHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <ResponsiveModalBody className="space-y-5">
            <ResponsiveModalDescription>{t("theme.import.description")}</ResponsiveModalDescription>
            <div className="grid gap-1.5">
              <Label htmlFor="theme-json-file">{t("theme.import.fileLabel")}</Label>
              <input
                ref={inputRef}
                id="theme-json-file"
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={handleFileChange}
              />
              <button
                ref={dropRef}
                data-native-file-drop
                type="button"
                className={cn(
                  "window-muted-surface flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong/20 px-4 py-5 text-center outline-none transition-colors hover:bg-muted/35 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                  dragging && "border-primary bg-primary/5",
                )}
                onClick={() => inputRef.current?.click()}
                onDragEnter={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setDragging(true)
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  event.dataTransfer.dropEffect = "copy"
                  setDragging(true)
                }}
                onDragLeave={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  const nextTarget = event.relatedTarget
                  if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                    setDragging(false)
                  }
                }}
                onDrop={handleDrop}
              >
                {importedFile ? (
                  <>
                    <CheckCircle2 className="size-7 text-primary" aria-hidden="true" />
                    <span className="max-w-full truncate font-medium">{importedFile.fileName}</span>
                    <span className="text-xs text-muted-foreground">{t("theme.import.replaceFile")}</span>
                  </>
                ) : (
                  <>
                    <span className="flex size-10 items-center justify-center rounded-xl bg-muted/35 shadow-sm ring-1 ring-border-strong/20">
                      <Upload className="size-5" aria-hidden="true" />
                    </span>
                    <span className="font-medium">{t("theme.import.chooseFile")}</span>
                    <span className="text-xs text-muted-foreground">{t("theme.import.dropFile")}</span>
                  </>
                )}
              </button>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="imported-theme-name">{t("theme.import.nameLabel")}</Label>
              <Input
                id="imported-theme-name"
                value={name}
                maxLength={120}
                disabled={!importedFile}
                placeholder={t("theme.import.namePlaceholder")}
                onChange={(event) => {
                  setName(event.target.value)
                  setError(null)
                }}
              />
            </div>

            {error && <FieldError>{error}</FieldError>}
          </ResponsiveModalBody>
          <ResponsiveModalFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t("theme.import.cancel")}
            </Button>
            <Button type="submit" disabled={!importedFile || !name.trim()}>
              <FileJson aria-hidden="true" />
              {t("theme.import.submit")}
            </Button>
          </ResponsiveModalFooter>
        </form>
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}

export function CustomThemeList() {
  const { snapshot, runtime } = useOriaTheme()
  const { t } = useTranslation()

  if (snapshot.customThemes.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">{t("theme.custom.empty")}</p>
  }

  return (
    <div role="list" className="grid w-full gap-1.5">
      {snapshot.customThemes.map((theme) => {
        const active = snapshot.preference.activeThemeId === theme.id
        return (
          <div
            key={theme.id}
            role="listitem"
            className="window-muted-surface flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 ring-1 ring-border-strong/20"
          >
            <ThemePaletteIcon theme={theme} mode={snapshot.resolvedMode} />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate text-sm font-medium">{theme.name}</span>
              {active && <Badge variant="secondary" className="shrink-0 font-normal">{t("theme.custom.active")}</Badge>}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("theme.custom.delete", { name: theme.name })}
              onClick={() => runtime.removeCustomTheme(theme.id)}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        )
      })}
    </div>
  )
}
