import type { ReactNode } from "react";
import { ExternalLink as ExternalLinkIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { LanguageSelect } from "@/components/language/language-select";
import { ThemeSelect } from "@/components/theme/theme-select";
import { ThemeModeToggle } from "@/components/theme/theme-mode-toggle";
import {
  CustomThemeList,
  ThemeImportSetting,
} from "@/components/theme/theme-import-setting";
import { buttonVariants } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import {
  WindowControlPositionSetting,
  WindowControlStyleSetting,
} from "@/components/settings/window-control-setting";
import { WindowAppearanceSettings } from "@/components/settings/window-appearance-setting";
import { isWindowsDesktop } from "@/components/theme/window-appearance";
import { ApplicationIconSetting } from "@/components/settings/application-icon-setting";

// Composition migrated from OriaAide's settings-panel.tsx, without unrelated app settings.
function SettingItem({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Item className="rounded-none border-0 px-3 py-2.5">
      <ItemContent className="min-w-0">
        <ItemTitle className="flex items-center gap-1.5">
          <span>{title}</span>
          {description && (
            <InfoTooltip description={description} label={title} />
          )}
        </ItemTitle>
      </ItemContent>
      <ItemActions className="max-w-full">{children}</ItemActions>
    </Item>
  );
}

export function WindowSettings() {
  const { t } = useTranslation();
  return (
    <ItemGroup className="settings-section-panel themed-surface gap-0 divide-y divide-border-strong/15 overflow-hidden rounded-xl">
      <SettingItem title={t("windowControls.styleLabel")}>
        <WindowControlStyleSetting />
      </SettingItem>
      <SettingItem
        title={t("windowControls.positionLabel")}
        description={t("windowControls.positionDescription")}
      >
        <WindowControlPositionSetting />
      </SettingItem>
      <WindowAppearanceSettings opacityOnly={isWindowsDesktop()} />
    </ItemGroup>
  );
}

export function AppearanceSettings() {
  const { t } = useTranslation();
  return (
    <ItemGroup className="settings-section-panel themed-surface gap-0 divide-y divide-border-strong/15 overflow-hidden rounded-xl">
      <SettingItem title={t("language.label")}>
        <LanguageSelect
          variant="outline"
          size="sm"
          className="min-w-36 justify-between"
          align="end"
        />
      </SettingItem>
      <SettingItem title={t("appAppearance.label")}>
        <ThemeModeToggle />
      </SettingItem>
      <SettingItem title={t("applicationIcon.label")} description={t("applicationIcon.description")}>
        <ApplicationIconSetting />
      </SettingItem>
      <SettingItem title={t("theme.label")}>
        <ThemeSelect
          variant="outline"
          size="sm"
          className="min-w-36 justify-between"
          align="end"
        />
      </SettingItem>
      <Item className="rounded-none border-0 px-3 py-2.5">
        <ItemContent className="min-w-0">
          <ItemTitle className="flex items-center gap-1.5">
            <span>{t("theme.custom.label")}</span>
          </ItemTitle>
        </ItemContent>
        <ItemActions className="ml-auto shrink-0 gap-1.5">
          <ExternalLink
            href="https://theme.oria.org.cn/zh/editor"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ExternalLinkIcon aria-hidden="true" />
            {t("theme.editor.open")}
          </ExternalLink>
          <ThemeImportSetting />
        </ItemActions>
        <div className="basis-full">
          <CustomThemeList />
        </div>
      </Item>
    </ItemGroup>
  );
}
