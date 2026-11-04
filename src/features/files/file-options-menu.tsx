import {
  ArrowDownAZ,
  ArrowUpNarrowWide,
  ArrowDownWideNarrow,
  Check,
  Clock,
  Eye,
  EyeOff,
  FolderPlus,
  FileType2,
  FilePlus2,
  FileUp,
  FolderUp,
  Ruler,
  Upload,
  Plus,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";

interface Props {
  remote: boolean;
  hidden: boolean;
  sort: string;
  descending: boolean;
  canCreate: boolean;
  canUpload: boolean;
  onHiddenChange: (hidden: boolean) => void;
  onSortChange: (sort: string) => void;
  onDescendingChange: (descending: boolean) => void;
  onCreate: () => void;
  onCreateText: () => void;
  onUpload: (folder: boolean) => void;
}

export function FileSortOptions(
  props: Pick<
    Props,
    "sort" | "descending" | "onSortChange" | "onDescendingChange"
  >,
) {
  const { t } = useTranslation("files");
  return (
    <>
      <DropdownMenuGroup>
        {["name", "type", "size", "modified"].map((sort) => (
          <DropdownMenuItem
            key={sort}
            role="menuitemradio"
            aria-checked={props.sort === sort}
            onClick={() => props.onSortChange(sort)}
          >
            {sort === "name" ? (
              <ArrowDownAZ />
            ) : sort === "type" ? (
              <FileType2 />
            ) : sort === "size" ? (
              <Ruler />
            ) : (
              <Clock />
            )}
            {t(sort)}
            {props.sort === sort && <Check className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        {[false, true].map((descending) => (
          <DropdownMenuItem
            key={String(descending)}
            role="menuitemradio"
            aria-checked={props.descending === descending}
            onClick={() => props.onDescendingChange(descending)}
          >
            {descending ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}
            {t(descending ? "descending" : "ascending")}
            {props.descending === descending && <Check className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </>
  );
}

export function FileCreateOptions(
  props: Pick<Props, "canCreate" | "onCreate" | "onCreateText">,
) {
  const { t } = useTranslation("files");
  return (
    <>
      <DropdownMenuItem disabled={!props.canCreate} onClick={props.onCreate}>
        <FolderPlus />
        {t("mkdir")}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!props.canCreate}
        onClick={props.onCreateText}
      >
        <FilePlus2 />
        {t("createText")}
      </DropdownMenuItem>
    </>
  );
}

export function FileUploadOptions(
  props: Pick<Props, "canUpload" | "onUpload">,
) {
  const { t } = useTranslation("files");
  return (
    <>
      {[false, true].map((folder) => (
        <DropdownMenuItem
          key={String(folder)}
          disabled={!props.canUpload}
          onClick={() => props.onUpload(folder)}
        >
          {folder ? <FolderUp /> : <FileUp />}
          {t(folder ? "uploadFolder" : "uploadFiles")}
        </DropdownMenuItem>
      ))}
    </>
  );
}

// Popup contents are shared by the local and remote file panes.
export function FileOptionsMenu(props: Props) {
  const { t } = useTranslation("files");
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>{t("viewOptions")}</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => props.onHiddenChange(!props.hidden)}>
          {props.hidden ? <EyeOff /> : <Eye />}
          {t(props.hidden ? "hideHidden" : "showHidden")}
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ArrowDownAZ />
            {t("sortBy")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="files-options-popup">
            <FileSortOptions {...props} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>{t("directoryOptions")}</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!props.canCreate}>
            <Plus />
            {t("create")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="files-options-popup">
            <FileCreateOptions {...props} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {props.remote && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!props.canUpload}>
              <Upload />
              {t("upload")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="files-options-popup">
              <FileUploadOptions {...props} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
      </DropdownMenuGroup>
    </>
  );
}
