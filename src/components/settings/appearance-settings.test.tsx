import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createOriaThemeRuntime } from "@oriatheme/runtime-dom";
import { OriaThemeProvider } from "@oriatheme/react";
import { oriaDefaultTheme, oriaPresetThemes } from "@oriatheme/presets";
import type { MouseEvent } from "react";

import i18n from "@/i18n";
import { AppearanceSettings, WindowSettings } from "./appearance-settings";
import { renameImportedTheme } from "@/components/theme/theme-import";
import { ExternalLink } from "@/components/ui/external-link";
import { openExternalUrl } from "@/lib/bridge";

vi.mock("@/lib/bridge", () => ({
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const config = {
  presets: oriaPresetThemes,
  defaultThemeId: oriaDefaultTheme.id,
  storage: false as const,
};
function runtime() {
  return createOriaThemeRuntime(config);
}

describe("migrated appearance settings", () => {
  it("renders selectors, editor link and the empty custom-theme list together", () => {
    const html = renderToStaticMarkup(
      <OriaThemeProvider config={config} runtime={runtime()}>
        <AppearanceSettings />
      </OriaThemeProvider>,
    );
    expect(html).toContain("简体中文");
    expect(html).toContain("Default");
    expect(html).toContain('href="https://theme.oria.org.cn/zh/editor"');
    expect(html).toContain(i18n.t("theme.import.add"));
    expect(html).toContain(i18n.t("theme.custom.empty"));
    expect(html).toContain('class="aide-theme-palette"');
    expect(html).toContain(i18n.t("applicationIcon.label"));
    for (const variant of ["system", "light", "dark", "mono"]) {
      expect(html).toContain(`aria-label="${i18n.t(`applicationIcon.${variant}`)}"`);
    }
  });

  it("shows an imported active theme with a delete action and returns to the preset after removal", () => {
    const themes = runtime();
    const custom = renameImportedTheme(
      oriaDefaultTheme,
      "Migration test theme",
      "migration-test-theme",
    );
    themes.importTheme(JSON.stringify(custom));
    themes.setTheme(custom.id);
    const render = () =>
      renderToStaticMarkup(
        <OriaThemeProvider config={config} runtime={themes}>
          <AppearanceSettings />
        </OriaThemeProvider>,
      );
    const html = render();
    expect(html).toContain(custom.name);
    expect(html).toContain(i18n.t("theme.custom.active"));
    expect(html).toContain(
      i18n.t("theme.custom.delete", { name: custom.name }),
    );
    expect(html).not.toContain(i18n.t("theme.custom.empty"));
    themes.removeCustomTheme(custom.id);
    expect(themes.getSnapshot().preference.activeThemeId).toBe(
      oriaDefaultTheme.id,
    );
    expect(render()).toContain(i18n.t("theme.custom.empty"));
  });

  it("places window style and position before opacity", () => {
    const html = renderToStaticMarkup(
      <OriaThemeProvider config={config} runtime={runtime()}>
        <WindowSettings />
      </OriaThemeProvider>,
    );
    const style = html.indexOf(i18n.t("windowControls.styleLabel"));
    const position = html.indexOf(i18n.t("windowControls.positionLabel"));
    const opacity = html.indexOf(i18n.t("windowAppearance.opacity"));
    expect(style).toBeGreaterThan(-1);
    expect(position).toBeGreaterThan(style);
    expect(opacity).toBeGreaterThan(position);
  });

  it("dispatches desktop editor clicks to the native opener and honors canceled clicks", () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const href = "https://theme.oria.org.cn/zh/editor";
    const event = {
      defaultPrevented: false,
      preventDefault: vi.fn(),
    } as unknown as MouseEvent<HTMLAnchorElement>;
    ExternalLink({ href }).props.onClick(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(openExternalUrl).toHaveBeenCalledWith(href);
    vi.mocked(openExternalUrl).mockClear();
    ExternalLink({ href }).props.onClick({ ...event, defaultPrevented: true });
    expect(openExternalUrl).not.toHaveBeenCalled();
  });
});
