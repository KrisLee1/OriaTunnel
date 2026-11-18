import {
  EyeOff,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  SearchX,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageEmptyState } from "@/components/page-empty-state";
import { Button } from "@/components/ui/button";
import type { Directory } from "./api";

export function FileDirectoryEmpty({
  directory,
  loading,
  error,
  query,
  clearSearch,
  showHidden,
  createFolder,
  retry,
}: {
  directory: Directory | null;
  loading: boolean;
  error: string | undefined;
  query: string;
  clearSearch: () => void;
  showHidden: () => void;
  createFolder: () => void;
  retry: () => void;
}) {
  const { t } = useTranslation("files");
  if (loading || (!directory && !error)) {
    return (
      <PageEmptyState
        compact
        role="status"
        icon={
          <LoaderCircle className="animate-spin motion-reduce:animate-none" />
        }
        title={t("loading")}
      />
    );
  }
  if (!directory) {
    return (
      <PageEmptyState
        compact
        role="alert"
        icon={<TriangleAlert />}
        title={t("readDirectoryFailed")}
        description={error && t(error, { defaultValue: error })}
        action={
          <Button size="sm" variant="outline" onClick={retry}>
            {t("refresh")}
          </Button>
        }
      />
    );
  }
  if (query) {
    return (
      <PageEmptyState
        compact
        icon={<SearchX />}
        title={t("noResults")}
        action={
          <Button size="sm" variant="outline" onClick={clearSearch}>
            {t("clearSearch")}
          </Button>
        }
      />
    );
  }
  if (directory.entries.length) {
    return (
      <PageEmptyState
        compact
        icon={<EyeOff />}
        title={t("hiddenOnly")}
        action={
          <Button size="sm" variant="outline" onClick={showHidden}>
            {t("showHidden")}
          </Button>
        }
      />
    );
  }
  return (
    <PageEmptyState
      compact
      icon={<FolderOpen />}
      title={t("empty")}
      action={
        directory.id && (
          <Button size="sm" variant="outline" onClick={createFolder}>
            <FolderPlus />
            {t("mkdir")}
          </Button>
        )
      }
    />
  );
}
