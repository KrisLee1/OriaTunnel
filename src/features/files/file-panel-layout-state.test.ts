import { afterEach, describe, expect, it, vi } from "vitest";
import {
  automaticFileLayout,
  filePanelOrientations,
  filePanelRatios,
  readFilePanelPreferences,
  saveFilePanelPreferences,
  FILE_PANEL_LAYOUT_KEY,
} from "./file-panel-layout-state";
afterEach(() => vi.unstubAllGlobals());

describe("file panel layouts", () => {
  it("chooses columns for wide/short, rows for narrow/tall, and split for comparable dimensions", () => {
    expect(automaticFileLayout(1200, 350)).toBe("columns");
    expect(automaticFileLayout(400, 850)).toBe("rows");
    expect(automaticFileLayout(800, 650)).toBe("split");
    expect(automaticFileLayout(650, 800)).toBe("split");
    expect(automaticFileLayout(0, 0)).toBe("split");
    expect(automaticFileLayout(NaN, 20, "rows")).toBe("rows");
  });
  it("does not flip axes repeatedly for small movements near a boundary", () => {
    expect(automaticFileLayout(1750, 1000, "columns")).toBe("columns");
    expect(automaticFileLayout(1600, 1000, "columns")).toBe("split");
    expect(automaticFileLayout(850, 1000, "rows")).toBe("rows");
    expect(automaticFileLayout(950, 1000, "rows")).toBe("split");
  });
  it("uses one stable nested Group topology for all three arrangements", () => {
    expect(filePanelOrientations("columns")).toEqual({
      outer: "horizontal",
      inner: "horizontal",
    });
    expect(filePanelOrientations("rows")).toEqual({
      outer: "vertical",
      inner: "vertical",
    });
    expect(filePanelOrientations("split")).toEqual({
      outer: "vertical",
      inner: "horizontal",
    });
    expect(
      filePanelRatios({ mode: "auto", ratios: {} }, "columns").browser,
    ).toBeCloseTo(200 / 3);
    expect(filePanelRatios({ mode: "auto", ratios: {} }, "split").browser).toBe(
      70,
    );
  });
  it("stores independent layouts and imports the previous file-pane proportions", () => {
    const storage = new Map([
      ["oria-tunnel.files-layout", JSON.stringify({ local: 40, remote: 60 })],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    expect(readFilePanelPreferences().ratios.rows?.local).toBe(40);
    const value = {
      mode: "rows" as const,
      ratios: {
        rows: { browser: 60, local: 35 },
        columns: { browser: 70, local: 60 },
      },
    };
    saveFilePanelPreferences(value);
    expect(readFilePanelPreferences()).toEqual(value);
    expect(storage.has(FILE_PANEL_LAYOUT_KEY)).toBe(true);
  });
  it("rejects corrupt modes/ratios and remains usable when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({
          mode: "wrong",
          ratios: {
            columns: { browser: 300, local: 50 },
            rows: { browser: 60, local: 30 },
          },
        }),
    });
    expect(readFilePanelPreferences()).toEqual({
      mode: "auto",
      ratios: { rows: { browser: 60, local: 30 } },
    });
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw Error("blocked");
      },
      setItem: () => {
        throw Error("blocked");
      },
    });
    expect(readFilePanelPreferences()).toEqual({ mode: "auto", ratios: {} });
    expect(() =>
      saveFilePanelPreferences({ mode: "auto", ratios: {} }),
    ).not.toThrow();
  });
});
