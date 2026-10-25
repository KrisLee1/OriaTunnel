import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createOriaThemeRuntime } from "@oriatheme/runtime-dom";
import { OriaThemeProvider } from "@oriatheme/react";
import { oriaDefaultTheme, oriaPresetThemes } from "@oriatheme/presets";
import i18n from "@/i18n";
import { supportedLanguages } from "@/i18n-resources";
import { InitialPreferenceSettings } from "./appearance-settings";
import { firstUsePreferencesCompleted } from "./first-use-preferences";

describe("first-use preferences", () => {
  it("requires an explicit completion marker and tolerates unavailable storage", () => {
    expect(firstUsePreferencesCompleted(undefined)).toBe(false);
    for (const value of [null, "", "false", "completed"]) {
      expect(firstUsePreferencesCompleted({ getItem: () => value })).toBe(
        value === "completed",
      );
    }
    expect(
      firstUsePreferencesCompleted({
        getItem: () => {
          throw new Error("unavailable");
        },
      }),
    ).toBe(false);
  });

  it("reuses all initial preference controls in eight languages without advanced settings", async () => {
    const config = {
      presets: oriaPresetThemes,
      defaultThemeId: oriaDefaultTheme.id,
      storage: false as const,
    };
    try {
      for (const language of supportedLanguages) {
        await i18n.changeLanguage(language);
        const html = renderToStaticMarkup(
          <OriaThemeProvider
            config={config}
            runtime={createOriaThemeRuntime(config)}
          >
            <InitialPreferenceSettings />
          </OriaThemeProvider>,
        );
        for (const key of [
          "language.label",
          "theme.label",
          "appAppearance.label",
          "applicationIcon.label",
          "windowControls.styleLabel",
          "windowControls.positionLabel",
        ]) {
          expect(html).toContain(i18n.t(key));
        }
        expect(html).not.toContain(i18n.t("windowAppearance.opacity"));
        expect(html).not.toContain("theme.oria.org.cn");
        expect(i18n.t("initialPreferences.done")).not.toBe(
          "initialPreferences.done",
        );
      }
    } finally {
      await i18n.changeLanguage("zh-CN");
    }
  });
});
