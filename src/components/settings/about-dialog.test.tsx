import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "@/i18n";
import { AboutButton, hasApplicationUpdate } from "./about-dialog";
import type { UpdateSnapshot } from "@/types";

const initial: UpdateSnapshot = {
  revision: 1,
  currentVersion: "0.1.0",
  phase: "idle",
  unavailable: null,
  autoCheck: true,
  preferenceError: false,
  release: null,
  downloaded: 0,
  total: null,
  error: null,
  canDownload: false,
  canInstall: false,
};
describe("about entry", () => {
  it("uses the transparent SVG inside Avatar and has a named dialog button", () => {
    const html = renderToStaticMarkup(
      <AboutButton snapshot={initial} onClick={() => {}} />,
    );
    expect(html).toContain('data-slot="avatar"');
    expect(html).toContain('data-slot="avatar-image"');
    expect(html).toContain("oria-tunnel-logo.svg");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain(
      `aria-label="${i18n.t("about.open", { ns: "updater" })}"`,
    );
    expect(html).not.toContain('data-slot="avatar-badge"');
  });
  it("shows a text-free update dot only for an available or retryable update", () => {
    expect(hasApplicationUpdate(null)).toBe(false);
    expect(hasApplicationUpdate(initial)).toBe(false);
    for (const phase of [
      "available",
      "downloading",
      "ready",
      "error",
    ] as const) {
      const snapshot = {
        ...initial,
        phase,
        release: { version: "0.2.0", notes: "" },
      };
      const html = renderToStaticMarkup(
        <AboutButton snapshot={snapshot} onClick={() => {}} />,
      );
      expect(html).toContain('data-slot="avatar-badge"');
      expect(html).not.toContain(">new</span>");
      expect(html).toMatch(/data-slot="avatar-badge"[^>]*><\/span>/);
      expect(html).toContain(i18n.t("about.openWithUpdate", { ns: "updater" }));
      expect(
        hasApplicationUpdate({ ...snapshot, unavailable: "development" }),
      ).toBe(false);
    }
  });
});
