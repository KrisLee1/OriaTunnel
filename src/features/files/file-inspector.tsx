import { HardDrive, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileArtwork } from "./file-artwork";
import { displayPath, size, type Entry } from "./api";

export type FileTarget = {
  entry: Entry;
  path: string;
  remote: boolean;
  hostName?: string;
  drive?: boolean;
};

export function FileIdentity({
  target,
  preview = false,
  status,
}: {
  target: FileTarget;
  preview?: boolean;
  status?: string;
}) {
  const { t } = useTranslation("files");
  const { entry } = target;
  const kind = target.drive
    ? "drive"
    : entry.kind === "directory"
      ? "folder"
      : ["file", "link"].includes(entry.kind)
        ? entry.kind
        : "other";
  return (
    <div className="files-inspector-identity">
      <FileArtwork
        name={entry.name}
        kind={target.drive ? "drive" : entry.kind}
        large
      />
      <div className="files-inspector-summary">
        <h3 data-selectable="true">{entry.name}</h3>
        <div className="files-inspector-meta">
          <span className="files-inspector-host">
            {target.remote ? <Server /> : <HardDrive />}
            {target.remote ? target.hostName || t("remote") : t("local")}
          </span>
          <span>{t(kind)}</span>
          {preview && (
            <>
              <span>{size(entry.size)}</span>
              <span>{status || t("readonly")}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function FilePropertiesContent({ target }: { target: FileTarget }) {
  const { t, i18n } = useTranslation("files");
  const { entry } = target;
  const details = [
    ["size", entry.kind === "file" ? size(entry.size) : "—"],
    [
      "modified",
      entry.modified
        ? new Date(entry.modified).toLocaleString(i18n.language)
        : "—",
    ],
    [
      "permissions",
      entry.permissions == null
        ? "—"
        : (entry.permissions & 0o7777).toString(8).padStart(3, "0"),
    ],
  ];
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("properties")}</DialogTitle>
        <DialogDescription className="sr-only">{entry.name}</DialogDescription>
      </DialogHeader>
      <ScrollArea
        className="files-properties-body"
        viewportClassName="scroll-fade"
        contentClassName="files-properties-content"
      >
        <FileIdentity target={target} />
        <dl
          className="files-properties-details files-inspector-card"
          data-selectable="true"
        >
          {details.map(([label, value]) => (
            <div key={label}>
              <dt>{t(label)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
          <div className="files-properties-path">
            <dt>{t("filePath")}</dt>
            <dd>
              <code>{displayPath(target.path)}</code>
            </dd>
          </div>
        </dl>
      </ScrollArea>
    </>
  );
}

export function FilePropertiesDialog({
  target,
  close,
}: {
  target: FileTarget | null;
  close: () => void;
}) {
  const { t } = useTranslation("files");
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="files-inspector files-properties"
        closeLabel={t("close")}
      >
        {target && <FilePropertiesContent target={target} />}
      </DialogContent>
    </Dialog>
  );
}
