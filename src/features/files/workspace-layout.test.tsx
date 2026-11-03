import "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FileWorkspaceProvider } from "./file-workspace";
import { TerminalWorkspaceProvider } from "@/features/terminal/terminal-workspace";
import type { Snapshot } from "@/types";

const data = { hosts: [], rules: [], services: [] } as unknown as Snapshot;
afterEach(() => vi.unstubAllGlobals());

describe("floating file workspace", () => {
  for (const dock of ["bottom", "left", "right"] as const) {
    it(`uses a nonmodal ${dock} panel with ${dock === "bottom" ? "horizontal" : "vertical"} file panes`, () => {
      vi.stubGlobal("localStorage", {
        getItem: (key: string) =>
          key === "oria-tunnel.files-workspace.v1"
            ? JSON.stringify({
                dock,
                sizes: { bottom: 480, left: 440, right: 460 },
              })
            : null,
      });
      const html = renderToStaticMarkup(
        <FileWorkspaceProvider data={data}>
          <main>Page content</main>
        </FileWorkspaceProvider>,
      );
      expect(html).toMatch(
        new RegExp(`class="[^"]*files-workspace"[^>]*data-dock="${dock}"`),
      );
      expect(html).toContain(
        `data-file-browser-layout="${dock === "bottom" ? "horizontal" : "vertical"}"`,
      );
      expect(html).toContain("Page content");
      expect(html).not.toContain('role="dialog"');
      expect(html).not.toContain('data-slot="dialog-overlay"');
      expect(html).toContain('class="workspace-panel-actions"');
    });
  }

  it("keeps file and terminal placement preferences independent", () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        JSON.stringify({
          dock: key === "oria-tunnel.files-workspace.v1" ? "right" : "left",
          sizes: { bottom: 480, left: 500, right: 440 },
        }),
    });
    const html = renderToStaticMarkup(
      <TerminalWorkspaceProvider data={data}>
        <FileWorkspaceProvider data={data}>
          <main />
        </FileWorkspaceProvider>
      </TerminalWorkspaceProvider>,
    );
    expect(html).toMatch(/class="[^"]*files-workspace"[^>]*data-dock="right"/);
    expect(html).toMatch(
      /class="[^"]*terminal-workspace"[^>]*data-dock="left"/,
    );
  });
});
