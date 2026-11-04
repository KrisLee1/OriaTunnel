import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { displayPath } from "./api";
import type { TransferHost } from "./transfer-list";

type PathEndpoint = {
  host: TransferHost;
  path: string | null;
  description?: string;
  onOpen?: () => void;
};

export function TransferPaths({
  source,
  target,
}: {
  source: PathEndpoint;
  target: PathEndpoint;
}) {
  const { t } = useTranslation("files");
  const endpoint = (value: PathEndpoint, side: "source" | "target") => {
    const address = `${value.host.name || t(value.host.remote ? "remote" : "local")} · ${value.path ? displayPath(value.path) : value.description || t("targetNotRecorded")}`;
    const label = t(side === "source" ? "sourcePath" : "targetPath");
    return (
      <span className="files-transfer-endpoint" role="group" aria-label={label}>
        {!value.host.remote && value.path && value.onOpen ? (
          <button
            type="button"
            className="files-transfer-target"
            title={`${label} · ${t("openFolder")} · ${address}`}
            onClick={value.onOpen}
          >
            {address}
          </button>
        ) : (
          <code data-selectable="true" title={`${label} · ${address}`}>
            {address}
          </code>
        )}
      </span>
    );
  };
  return (
    <div className="files-transfer-paths">
      {endpoint(source, "source")}
      <ArrowRight aria-hidden="true" />
      {endpoint(target, "target")}
    </div>
  );
}
