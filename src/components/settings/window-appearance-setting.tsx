import { RotateCcwIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOriaTheme } from "@oriatheme/react";

import { themeWindowAppearance } from "@/components/theme/window-appearance";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemTitle,
} from "@/components/ui/item";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useWindowAppearanceSettingsStore } from "@/stores/window-appearance-settings-store";

export function WindowAppearanceSettings({
  opacityOnly = false,
}: {
  opacityOnly?: boolean;
}) {
  const { t } = useTranslation();
  const { snapshot } = useOriaTheme();
  const opacity = useWindowAppearanceSettingsStore((state) => state.opacity);
  const blurRadius = useWindowAppearanceSettingsStore(
    (state) => state.blurRadius,
  );
  const cornerRadius = useWindowAppearanceSettingsStore(
    (state) => state.cornerRadius,
  );
  const setOpacity = useWindowAppearanceSettingsStore(
    (state) => state.setOpacity,
  );
  const setBlurRadius = useWindowAppearanceSettingsStore(
    (state) => state.setBlurRadius,
  );
  const setCornerRadius = useWindowAppearanceSettingsStore(
    (state) => state.setCornerRadius,
  );
  const windowsBlurEnabled = useWindowAppearanceSettingsStore(
    (state) => state.windowsBlurEnabled,
  );
  const setWindowsBlurEnabled = useWindowAppearanceSettingsStore(
    (state) => state.setWindowsBlurEnabled,
  );
  const followTheme = useWindowAppearanceSettingsStore(
    (state) => state.followTheme,
  );
  const theme = themeWindowAppearance(snapshot.resolvedTheme.variables);
  const customCount = (
    opacityOnly ? [opacity] : [opacity, blurRadius, cornerRadius]
  ).filter((value) => value !== null).length;

  return (
    <>
      <AppearanceSlider
        label={t("windowAppearance.opacity")}
        value={opacity ?? theme.opacity}
        themeValue={theme.opacity}
        custom={opacity !== null}
        min={1}
        max={100}
        unit="%"
        onChange={setOpacity}
        onFollowTheme={() => setOpacity(null)}
      />
      {opacityOnly && (
        <Item className="rounded-none border-0 px-3 py-2.5">
          <ItemContent>
            <ItemTitle>{t("windowAppearance.windowsBlur")}</ItemTitle>
          </ItemContent>
          <ItemActions>
            <Switch
              checked={windowsBlurEnabled}
              aria-label={t("windowAppearance.windowsBlur")}
              onCheckedChange={setWindowsBlurEnabled}
            />
          </ItemActions>
        </Item>
      )}
      {!opacityOnly && (
        <>
          <AppearanceSlider
            label={t("windowAppearance.blurRadius")}
            value={blurRadius ?? theme.blurRadius}
            themeValue={theme.blurRadius}
            custom={blurRadius !== null}
            min={0}
            max={64}
            unit="px"
            onChange={setBlurRadius}
            onFollowTheme={() => setBlurRadius(null)}
          />
          <AppearanceSlider
            label={t("windowAppearance.cornerRadius")}
            value={cornerRadius ?? theme.cornerRadius}
            themeValue={theme.cornerRadius}
            custom={cornerRadius !== null}
            min={0}
            max={64}
            unit="px"
            onChange={setCornerRadius}
            onFollowTheme={() => setCornerRadius(null)}
          />
          <Item className="justify-end rounded-none border-0 px-3 py-2.5">
            <ItemActions className="ml-auto">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={customCount === 0}
                onClick={followTheme}
              >
                <RotateCcwIcon aria-hidden="true" />
                {t("windowAppearance.followThemeAll")}
              </Button>
            </ItemActions>
          </Item>
        </>
      )}
    </>
  );
}

function AppearanceSlider({
  label,
  value,
  themeValue,
  custom,
  min,
  max,
  unit,
  onChange,
  onFollowTheme,
}: {
  label: string;
  value: number;
  themeValue: number;
  custom: boolean;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number | null) => void;
  onFollowTheme: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Item className="flex-nowrap rounded-none border-0 px-3 py-2.5">
      <ItemContent className="min-w-0">
        <ItemTitle className="gap-1.5 overflow-visible">
          <span className="whitespace-nowrap">{label}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={!custom}
            aria-label={t("windowAppearance.followThemeFor", {
              setting: label,
            })}
            title={t("windowAppearance.followTheme")}
            onClick={onFollowTheme}
          >
            <RotateCcwIcon aria-hidden="true" />
          </Button>
        </ItemTitle>
      </ItemContent>
      <ItemActions className="w-1/2 min-w-40 max-w-xs gap-3">
        <Slider
          className="min-w-0 flex-1"
          value={[value]}
          min={min}
          max={max}
          step={1}
          aria-label={label}
          onValueChange={(next) =>
            onChange((typeof next === "number" ? next : next[0]) ?? themeValue)
          }
        />
        <span className="min-w-11 text-right font-mono text-xs text-muted-foreground">
          {value}
          {unit}
        </span>
      </ItemActions>
    </Item>
  );
}
