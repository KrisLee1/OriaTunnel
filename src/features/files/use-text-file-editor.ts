import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/components/ui/toast";
import { formatNativeMessage } from "@/lib/native-message";
import { api, displayPath, type TextDocument } from "./api";

export function useTextFileEditor(
  id: string,
  onRead: (document: TextDocument) => void,
  onSaved?: () => void,
) {
  const { t } = useTranslation("files");
  const [document, setDocument] = useState<TextDocument | null>(null);
  const [draft, setDraft] = useState("");
  const [opening, setOpening] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const report = (error: unknown) => {
    const detail =
      typeof error === "object" && error && "code" in error
        ? (error as { code: string; temporary?: string })
        : { code: String(error) };
    const description = t(detail.code, {
      defaultValue: formatNativeMessage(detail.code),
    });
    toast.add({
      type: "error",
      title: t("title"),
      description: detail.temporary
        ? `${description}\n${displayPath(detail.temporary)}`
        : description,
    });
  };
  const dirty = document !== null && draft !== document.text;
  const start = async () => {
    if (pending.current || document) return;
    pending.current = true;
    setOpening(true);
    try {
      const next = await api.readText(id);
      if (live.current) {
        setDocument(next);
        setDraft(next.text);
        onRead(next);
      }
    } catch (error) {
      if (live.current) report(error);
    } finally {
      pending.current = false;
      if (live.current) setOpening(false);
    }
  };
  const save = async () => {
    if (pending.current || !document || !dirty) return;
    pending.current = true;
    setSaving(true);
    const submitted = draft;
    try {
      const next = await api.writeText(id, document.version, submitted);
      if (live.current) {
        setDocument(next);
        setDraft((current) => (current === submitted ? next.text : current));
        onRead(next);
        onSaved?.();
        toast.add({ type: "success", title: t("editSaved") });
      }
    } catch (error) {
      if (live.current) report(error);
    } finally {
      pending.current = false;
      if (live.current) setSaving(false);
    }
  };
  return {
    document,
    draft,
    setDraft,
    dirty,
    opening,
    saving,
    start,
    save,
    cancel: () => {
      if (!pending.current) {
        setDocument(null);
        setDraft("");
      }
    },
  };
}
