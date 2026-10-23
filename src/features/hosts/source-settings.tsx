import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { ParameterTitle } from "@/components/parameter-field";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { FilePathsEditor } from "./file-paths-editor";
import { pickSshConfigFile } from "@/lib/bridge";
import type { Snapshot } from "@/types";

export function HostSourceSettings({
  data,
  busy,
  save,
}: {
  data: Snapshot;
  busy: boolean;
  save: (files: string[], autoSync: boolean) => Promise<boolean>;
}) {
  const { t } = useTranslation("tunnel");
  const syncId = useId();
  const [files, setFiles] = useState<string[]>(data.sourceFiles || []);
  const [autoSync, setAutoSync] = useState(data.autoSyncHosts ?? true);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(files, autoSync).then((ok) => {
          if (ok)
            toast.add({ title: t("sourcesSaved"), type: "success", timeout: 4000 });
        });
      }}
    >
      <ItemGroup className="settings-section-panel themed-surface gap-0 divide-y divide-border-strong/15 overflow-hidden rounded-xl">
        <Item className="rounded-none border-0 px-3 py-2.5">
          <FilePathsEditor
            className="grid w-full gap-2 text-xs"
            label={t("additionalSources")}
            description={t("sourcesHint")}
            value={files}
            disabled={busy}
            pickFile={pickSshConfigFile}
            addLabel={t("addSource")}
            chooseLabel={(count) => t("chooseSource", { count })}
            removeLabel={(count) => t("removeSource", { count })}
            placeholder={t("sourcePathPlaceholder")}
            formatError={(cause) =>
              String(cause).includes("pick_ssh_config_file")
                ? t("sourcePickerUpdateRequired")
                : String(cause)
            }
            onChange={setFiles}
          />
        </Item>
        <Item className="rounded-none border-0 px-3 py-2.5">
          <ItemContent className="min-w-0">
            <ItemTitle>
              <ParameterTitle
                label={t("autoSyncHosts")}
                description={t("autoSyncHint")}
                htmlFor={syncId}
              />
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <Switch
              id={syncId}
              checked={autoSync}
              onCheckedChange={setAutoSync}
            />
          </ItemActions>
        </Item>
        <Item className="justify-end rounded-none border-0 px-3 py-2.5">
          <Button size="sm" variant="outline" type="submit" disabled={busy}>
            {t("save")}
          </Button>
        </Item>
      </ItemGroup>
    </form>
  );
}
