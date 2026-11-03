import {
  ArrowDownAZ,
  Check,
  Clock,
  Eye,
  EyeOff,
  FolderPlus,
  Ruler,
  Upload,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface Props {
  remote: boolean;
  hidden: boolean;
  sort: string;
  canCreate: boolean;
  canUpload: boolean;
  onHiddenChange: (hidden: boolean) => void;
  onSortChange: (sort: string) => void;
  onCreate: () => void;
  onUpload: (folder: boolean) => void;
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
        <DropdownMenuLabel>{t("sortBy")}</DropdownMenuLabel>
        {["name", "size", "modified"].map((sort) => (
          <DropdownMenuItem key={sort} onClick={() => props.onSortChange(sort)}>
            {sort === "name" ? (
              <ArrowDownAZ />
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
        <DropdownMenuLabel>{t("directoryOptions")}</DropdownMenuLabel>
        <DropdownMenuItem disabled={!props.canCreate} onClick={props.onCreate}>
          <FolderPlus />
          {t("mkdir")}
        </DropdownMenuItem>
        {props.remote &&
          [false, true].map((folder) => (
            <DropdownMenuItem
              key={String(folder)}
              disabled={!props.canUpload}
              onClick={() => props.onUpload(folder)}
            >
              {folder ? <FolderPlus /> : <Upload />}
              {t(folder ? "uploadFolder" : "uploadFiles")}
            </DropdownMenuItem>
          ))}
      </DropdownMenuGroup>
    </>
  );
}
