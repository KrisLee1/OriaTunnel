import { useTranslation } from "react-i18next";
import { FilePathsEditor } from "./file-paths-editor";

export function IdentityFilesEditor({
  value,
  onChange,
  disabled,
  pickFile,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled: boolean;
  pickFile?: () => Promise<string | null>;
}) {
  const { t } = useTranslation("tunnel");
  return (
    <FilePathsEditor
      value={value}
      onChange={onChange}
      disabled={disabled}
      pickFile={pickFile}
      label={t("identity")}
      addLabel={t("addIdentity")}
      chooseLabel={(count) => t("chooseIdentity", { count })}
      removeLabel={(count) => t("removeIdentity", { count })}
      formatError={(cause) =>
        String(cause).includes("pick_identity_file")
          ? t("identityPickerUpdateRequired")
          : String(cause)
      }
    />
  );
}
