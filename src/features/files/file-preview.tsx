import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Code2,
  Eye,
  FileText,
  LoaderCircle,
  Pencil,
  Save,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { FileCodePreview } from "./file-code-preview";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, displayPath } from "./api";
import { FileIdentity, type FileTarget } from "./file-inspector";
import { svgPreviewSource } from "./svg-preview-source";
import { useTextFileEditor } from "./use-text-file-editor";
import { FileTextEditor } from "./file-text-editor";
const MarkdownDocument = lazy(() => import("./markdown/markdown-document"));

const languages: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  rs: "rust",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  bat: "dos",
  cmd: "dos",
  json: "json",
  jsonl: "json",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  sql: "sql",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  conf: "ini",
  c: "c",
  cpp: "cpp",
  h: "c",
  java: "java",
  go: "go",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  lua: "lua",
  diff: "diff",
  patch: "diff",
};
export function previewLanguage(name: string) {
  if (/^\.(env|gitconfig)(\.|$)/i.test(name)) return "ini";
  if (/^\.(bashrc|zshrc)$/i.test(name)) return "bash";
  if (/^dockerfile(\.|$)/i.test(name)) return "dockerfile";
  if (/^makefile$/i.test(name)) return "makefile";
  return languages[name.split(".").pop()?.toLowerCase() || ""] || "text";
}

function SvgImagePreview({ source, name }: { source: string; name: string }) {
  const { t } = useTranslation("files");
  const [image, setImage] = useState({ url: "", error: false });
  useEffect(() => {
    let url = "";
    try {
      url = URL.createObjectURL(
        new Blob([svgPreviewSource(source)], { type: "image/svg+xml" }),
      );
      setImage({ url, error: false });
    } catch {
      setImage({ url: "", error: true });
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [source]);
  return image.error ? (
    <div className="files-preview-state files-preview-error" role="alert">
      <TriangleAlert />
      <p>{t("previewUnsupported")}</p>
    </div>
  ) : image.url ? (
    <ScrollArea
      className="files-preview-image"
      viewportClassName="scroll-fade"
      contentClassName="files-preview-image-content"
    >
      <img
        src={image.url}
        alt={name}
        onError={() => setImage({ url: "", error: true })}
      />
    </ScrollArea>
  ) : (
    <div className="files-preview-state" role="status">
      <LoaderCircle className="files-preview-spinner" />
    </div>
  );
}

function PreviewContent({
  target,
  close,
  closeRequest,
  onSaved,
}: {
  target: FileTarget;
  close: () => void;
  closeRequest: { current: () => void };
  onSaved?: () => void;
}) {
  const { t } = useTranslation("files");
  const { entry } = target;
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [raw, setRaw] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [readBytes, setReadBytes] = useState(0);
  const [fileSize, setFileSize] = useState(entry.size);
  const [pendingDiscard, setPendingDiscard] = useState<"close" | "edit" | null>(
    null,
  );
  const editor = useTextFileEditor(
    entry.id,
    (document) => {
      setText(document.text);
      setFileSize(document.size);
      setReadBytes(document.size);
    },
    onSaved,
  );
  const editing = !!editor.document;
  const displayText = editing ? editor.draft : text;
  useLayoutEffect(() => {
    closeRequest.current = () => {
      if (editor.saving) return;
      if (editor.dirty) setPendingDiscard("close");
      else close();
    };
    return () => {
      closeRequest.current = close;
    };
  }, [close, closeRequest, editor.dirty, editor.saving]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!pendingDiscard) void editor.save();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [editor.save, pendingDiscard]);
  const markdown = /\.(md|markdown|mdown)$/i.test(entry.name);
  const imageType = entry.name
    .match(/\.(png|jpe?g|webp|gif|svg)$/i)?.[1]
    .toLowerCase();
  const vector = imageType === "svg";
  useEffect(() => {
    let live = true,
      objectUrl = "";
    setLoading(true);
    setError("");
    setImageError(false);
    void api
      .preview(entry.id, expanded)
      .then((result) => {
        if (!live) return;
        const bytes = new Uint8Array(result);
        setReadBytes(bytes.length);
        if (imageType && !vector) {
          objectUrl = URL.createObjectURL(
            new Blob([bytes], {
              type: `image/${imageType === "jpg" ? "jpeg" : imageType}`,
            }),
          );
          setUrl(objectUrl);
        } else {
          let encoding = "utf-8";
          if (bytes[0] === 255 && bytes[1] === 254) encoding = "utf-16le";
          if (bytes[0] === 254 && bytes[1] === 255) encoding = "utf-16be";
          try {
            setText(
              new TextDecoder(encoding, { fatal: true }).decode(bytes, {
                stream: entry.size > bytes.length,
              }),
            );
          } catch {
            setError("previewUnsupported");
          }
        }
      })
      .catch((error) => live && setError(String(error)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [entry.id, expanded, imageType]);
  const truncated = (!imageType || vector) && !error && fileSize > readBytes;
  const hasPreview = markdown || vector;
  const sourceView = raw || (vector && truncated && !!displayText);
  const initialLoading = loading && !displayText && !url;
  const showCode =
    !initialLoading &&
    !error &&
    (sourceView || (!markdown && !imageType && (!!displayText || editing)));
  const modeAction = hasPreview ? (
    <Button
      variant="ghost"
      size="icon-xs"
      className="files-preview-mode"
      aria-label={t(sourceView ? "preview" : "source")}
      title={t(sourceView ? "preview" : "source")}
      disabled={(vector && truncated && !raw) || editor.saving}
      onClick={() => setRaw(!sourceView)}
    >
      {sourceView ? <Eye /> : <Code2 />}
    </Button>
  ) : undefined;
  const actions = (
    <>
      {(!imageType || vector) &&
        (editing ? (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("editSave")}
              title={`${t("editSave")} (Ctrl/⌘+S)`}
              disabled={!editor.dirty || editor.saving}
              onClick={() => void editor.save()}
            >
              {editor.saving ? (
                <LoaderCircle className="files-preview-spinner" />
              ) : (
                <Save />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("editCancel")}
              title={t("editCancel")}
              disabled={editor.saving}
              onClick={() =>
                editor.dirty ? setPendingDiscard("edit") : editor.cancel()
              }
            >
              <Undo2 />
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("editFile")}
            title={t("editFile")}
            disabled={loading || !!error || editor.opening}
            onClick={() => {
              setRaw(true);
              void editor.start();
            }}
          >
            {editor.opening ? (
              <LoaderCircle className="files-preview-spinner" />
            ) : (
              <Pencil />
            )}
          </Button>
        ))}
      {modeAction}
    </>
  );
  const stateClass = `files-preview-state${hasPreview || !imageType ? "" : " files-inspector-card"}`;
  const content = initialLoading ? (
    <div className={stateClass} role="status">
      <LoaderCircle className="files-preview-spinner" />
      <p>{t("loading")}</p>
    </div>
  ) : error ? (
    <div className={`${stateClass} files-preview-error`} role="alert">
      <TriangleAlert />
      <p>{t(error, { defaultValue: error })}</p>
    </div>
  ) : showCode && editor.document ? (
    <FileTextEditor
      value={editor.draft}
      onChange={editor.setDraft}
      language={previewLanguage(entry.name)}
      encoding={editor.document.encoding}
      lineEnding={editor.document.lineEnding}
      saving={editor.saving}
      actions={actions}
    />
  ) : showCode ? (
    <FileCodePreview
      key={entry.id}
      code={displayText}
      language={previewLanguage(entry.name)}
      actions={actions}
    />
  ) : imageError ? (
    <div className={`${stateClass} files-preview-error`} role="alert">
      <TriangleAlert />
      <p>{t("previewUnsupported")}</p>
    </div>
  ) : vector ? (
    <SvgImagePreview source={displayText} name={entry.name} />
  ) : imageType && url ? (
    <ScrollArea
      className="files-preview-image files-inspector-card"
      viewportClassName="scroll-fade"
      contentClassName="files-preview-image-content"
    >
      <img src={url} alt={entry.name} onError={() => setImageError(true)} />
    </ScrollArea>
  ) : displayText && markdown ? (
    <ScrollArea
      className="files-preview-markdown"
      viewportClassName="scroll-fade"
      contentClassName="files-preview-markdown-content"
    >
      <Suspense fallback={<p role="status">{t("loading")}</p>}>
        <MarkdownDocument content={displayText} />
      </Suspense>
    </ScrollArea>
  ) : (
    <div className={stateClass}>
      <FileText />
      <p>{t("emptyFile")}</p>
    </div>
  );
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("preview")}</DialogTitle>
        <DialogDescription className="sr-only">{entry.name}</DialogDescription>
      </DialogHeader>
      <div className="files-preview-summary files-inspector-card">
        <FileIdentity
          target={{ ...target, entry: { ...entry, size: fileSize } }}
          preview
          status={t(
            editor.dirty ? "editUnsaved" : editing ? "editing" : "readonly",
          )}
        />
        <p className="files-inspector-address" data-selectable="true">
          {displayPath(target.path)}
        </p>
      </div>
      {(hasPreview || !imageType) && !showCode ? (
        <CodeBlock className="files-preview-code">
          <CodeBlockHeader>
            <CodeBlockTitle>
              {vector
                ? "SVG"
                : markdown
                  ? "Markdown"
                  : previewLanguage(entry.name)}
            </CodeBlockTitle>
            <CodeBlockActions>
              <CodeBlockCopyButton
                value={displayText}
                disabled={!displayText}
              />
              {actions}
            </CodeBlockActions>
          </CodeBlockHeader>
          {content}
        </CodeBlock>
      ) : (
        content
      )}
      {truncated && (
        <div className="files-preview-footer">
          <p>{t(loading ? "loading" : "truncated")}</p>
          {(!expanded || loading) && (
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => setExpanded(true)}
            >
              {t("loadMore")}
            </Button>
          )}
        </div>
      )}
      <Dialog
        open={pendingDiscard !== null}
        onOpenChange={(open) => !open && setPendingDiscard(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editDiscardTitle")}</DialogTitle>
            <DialogDescription>{t("editDiscardDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDiscard(null)}>
              {t("editContinue")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const action = pendingDiscard;
                setPendingDiscard(null);
                if (action === "close") close();
                else editor.cancel();
              }}
            >
              {t("editDiscard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function FilePreviewDialog({
  target,
  close,
  onSaved,
}: {
  target: FileTarget | null;
  close: () => void;
  onSaved?: () => void;
}) {
  const { t } = useTranslation("files");
  const closeRequest = useRef(close);
  return (
    <Dialog
      open={!!target}
      onOpenChange={(open) => !open && closeRequest.current()}
    >
      <DialogContent
        className="files-inspector files-preview"
        closeLabel={t("close")}
      >
        {target && (
          <PreviewContent
            key={target.entry.id}
            target={target}
            close={close}
            closeRequest={closeRequest}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
