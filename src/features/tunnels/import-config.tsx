import { useRef, useState, type DragEvent } from "react";
import { UploadIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal, Field, ModalActions } from "@/components/tunnel-form";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { useNativeFileDrop } from "@/hooks/use-native-file-drop";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import type { Host, ImportChoices, ImportPreview, ImportSource } from "@/types";

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export function ImportConfig({
  hosts,
  busy,
  close,
  previewFile,
  cancelPreview,
  submit,
}: {
  hosts: Host[];
  busy: boolean;
  close: () => void;
  previewFile: (source: ImportSource) => Promise<ImportPreview>;
  cancelPreview: () => Promise<void>;
  submit: (token: string, choices: ImportChoices) => Promise<boolean>;
}) {
  const { t } = useTranslation("tunnel");
  const dropRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabled = busy || loading;
  const showError = (cause: unknown) => {
    const message = String(cause);
    setError(
      message.includes("preview_import_file")
        ? t("importBackendUpdateRequired")
        : message,
    );
  };
  async function load(source: () => Promise<ImportSource>) {
    if (pending.current || busy) return;
    pending.current = true;
    setLoading(true);
    setDragging(false);
    setError(null);
    try {
      setPreview(await previewFile(await source()));
    } catch (cause) {
      showError(cause);
    } finally {
      pending.current = false;
      setLoading(false);
    }
  }
  function loadFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".json")) {
      setError(t("importFileType"));
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setError(t("importFileSize"));
      return;
    }
    void load(async () => ({
      kind: "upload",
      fileName: file.name,
      content: await file.text(),
    }));
  }
  function loadPaths(paths: string[]) {
    if (paths.length !== 1) {
      setError(t("importSingleFile"));
      return;
    }
    if (!paths[0].toLowerCase().endsWith(".json")) {
      setError(t("importFileType"));
      return;
    }
    void load(async () => ({ kind: "path", path: paths[0] }));
  }
  useNativeFileDrop(dropRef, !preview && !disabled, loadPaths, setDragging);
  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    if (disabled) return;
    if (event.dataTransfer.files.length !== 1) {
      setError(t("importSingleFile"));
      return;
    }
    loadFile(event.dataTransfer.files[0]);
  }
  async function replaceFile() {
    if (disabled || pending.current) return;
    pending.current = true;
    setLoading(true);
    setError(null);
    try {
      await cancelPreview();
      setPreview(null);
    } catch (cause) {
      showError(cause);
    } finally {
      pending.current = false;
      setLoading(false);
    }
  }
  return (
    <Modal
      title={t("importConfig")}
      description={t(preview ? "importHint" : "importFileHint")}
      close={() => {
        if (!disabled) close();
      }}
    >
      {error && <FieldError role="alert">{error}</FieldError>}
      {preview ? (
        <>
          <div className="import-file-heading">
            <span>{preview.fileName}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => void replaceFile()}
            >
              {t("importReplaceFile")}
            </Button>
          </div>
          <ImportConfigReview
            key={preview.token}
            preview={preview}
            hosts={hosts}
            busy={disabled}
            close={close}
            submit={(choices) => submit(preview.token, choices)}
          />
        </>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            tabIndex={-1}
            aria-label={t("importChooseFile")}
            disabled={disabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) loadFile(file);
            }}
          />
          <button
            ref={dropRef}
            data-native-file-drop
            type="button"
            disabled={disabled}
            aria-busy={loading}
            className={cn(
              "window-muted-surface flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong/20 px-4 py-5 text-center text-sm outline-none transition-colors hover:bg-muted/35 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
              dragging && "border-primary bg-primary/5",
            )}
            onClick={() => inputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!disabled) setDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = disabled ? "none" : "copy";
              if (!disabled) setDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (
                !(event.relatedTarget instanceof Node) ||
                !event.currentTarget.contains(event.relatedTarget)
              )
                setDragging(false);
            }}
            onDrop={handleDrop}
          >
            <span className="flex size-10 items-center justify-center rounded-xl bg-muted/35 shadow-sm ring-1 ring-border-strong/20">
              <UploadIcon className="size-5" aria-hidden="true" />
            </span>
            <span className="font-medium">
              {t(loading ? "importReadingFile" : "importChooseFile")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("importDropFile")}
            </span>
          </button>
          <ModalActions>
            <Button variant="ghost" disabled={disabled} onClick={close}>
              {t("cancel")}
            </Button>
          </ModalActions>
        </>
      )}
    </Modal>
  );
}

function ImportConfigReview({
  preview,
  hosts,
  busy,
  close,
  submit,
}: {
  preview: ImportPreview;
  hosts: Host[];
  busy: boolean;
  close: () => void;
  submit: (choices: ImportChoices) => Promise<boolean>;
}) {
  const { t } = useTranslation("tunnel");
  const [selected, setSelected] = useState(
    preview.rules.filter((r) => !r.commandOmitted).map((r) => r.id),
  );
  const [reuseHosts, setReuseHosts] = useState<Record<string, string>>({});
  const [forwardOnly, setForwardOnly] = useState(false);
  const blocked =
    selected.some(
      (id) => preview.rules.find((r) => r.id === id)?.commandOmitted,
    ) && !forwardOnly;
  return (
    <>
      <h3>
        {t("hosts")} · {preview.hosts.length}
      </h3>
      {preview.hosts.map((h) => (
        <div className="import-entry themed-surface" key={h.id}>
          <strong>{h.name}</strong>
          <code>{h.endpoint}</code>
          {h.conflict && <p className="muted">{t("importHostConflict")}</p>}
          {h.blocked && (
            <p className="inline-error">{t("importHostBlocked")}</p>
          )}
          {h.keyPathsOmitted && (
            <p className="inline-error">{t("importMissingKeys")}</p>
          )}
          {!!h.keyPaths.length && (
            <p className="muted">
              {t("identity")}: {h.keyPaths.join(", ")}
            </p>
          )}
          {h.proxyJump && <p className="muted">ProxyJump: {h.proxyJump}</p>}
          <Field label={t("importHostAction")}>
            <Select
              items={[
                { value: "", label: t("importAsCopy") },
                ...hosts
                  .filter((old) => !old.diagnostics.length)
                  .map((old) => ({
                    value: old.id,
                    label: t("importReuse", {
                      name: `${old.name} · ${old.user}@${old.address}:${old.port}`,
                    }),
                  })),
              ]}
              value={reuseHosts[h.id] || ""}
              disabled={busy}
              onValueChange={(value) => {
                const next = { ...reuseHosts };
                if (value) next[h.id] = value;
                else delete next[h.id];
                setReuseHosts(next);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectItem value="">{t("importAsCopy")}</SelectItem>
                {hosts
                  .filter((old) => !old.diagnostics.length)
                  .map((old) => (
                    <SelectItem value={old.id} key={old.id}>
                      {t("importReuse", {
                        name: `${old.name} · ${old.user}@${old.address}:${old.port}`,
                      })}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      ))}
      <h3>
        {t("tunnels")} · {preview.rules.length}
      </h3>
      {preview.rules.map((r) => (
        <div className="import-entry themed-surface" key={r.id}>
          <label className="check-field">
            <input
              type="checkbox"
              checked={selected.includes(r.id)}
              disabled={busy}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, r.id]
                    : selected.filter((id) => id !== r.id),
                )
              }
            />
            {r.name}
          </label>
          <code>{r.path}</code>
          {r.conflict && <p className="muted">{t("importRuleConflict")}</p>}
          {r.listenerConflict && (
            <p className="inline-error">{t("importListenerConflict")}</p>
          )}
          {r.commandOmitted && (
            <p className="inline-error">{t("importCommandMissing")}</p>
          )}
        </div>
      ))}
      {preview.rules.some((r) => r.commandOmitted) && (
        <label className="check-field">
          <input
            type="checkbox"
            checked={forwardOnly}
            disabled={busy}
            onChange={(e) => setForwardOnly(e.target.checked)}
          />
          {t("importForwardOnly")}
        </label>
      )}
      <p className="muted">{t("importStopped")}</p>
      <ModalActions>
        <Button variant="ghost" disabled={busy} onClick={close}>
          {t("cancel")}
        </Button>
        <Button
          disabled={busy || !selected.length || blocked}
          onClick={() =>
            void submit({ ruleIds: selected, reuseHosts, forwardOnly })
          }
        >
          {t("importSelected", { count: selected.length })}
        </Button>
      </ModalActions>
    </>
  );
}
