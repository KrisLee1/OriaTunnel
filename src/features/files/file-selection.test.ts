import { afterEach, describe, expect, it, vi } from "vitest";
import { marqueeHits, mergeMarquee } from "./use-marquee-selection";
import { readLocalDirectory, saveLocalDirectory } from "./local-directory";
afterEach(() => vi.unstubAllGlobals());
describe("mouse rectangle selection", () => {
  it("does not select a file when a rectangle touches only the new item gaps", () => {
    expect(
      marqueeHits(
        ["a", "b", "c"],
        { left: 198, top: 10, width: 4, height: 10 },
        600,
        3,
        100,
        8,
        8,
      ),
    ).toEqual([]);
    expect(
      marqueeHits(
        ["a", "b", "c"],
        { left: 10, top: 98, width: 10, height: 4 },
        600,
        1,
        100,
        0,
        8,
      ),
    ).toEqual([]);
  });
  const ids = Array.from({ length: 1000 }, (_, i) => String(i));
  it("selects list rows by their content positions, including unmounted rows", () =>
    expect(
      marqueeHits(
        ids,
        { left: 50, top: 360, width: 60, height: 72 },
        600,
        1,
        36,
      ),
    ).toEqual(["10", "11"]));
  it("selects only intersecting grid columns and rows", () =>
    expect(
      marqueeHits(
        ids,
        { left: 205, top: 95, width: 180, height: 84 },
        600,
        3,
        92,
      ),
    ).toEqual(["4"]));
  it("handles a large virtual range without using mounted element geometry", () =>
    expect(
      marqueeHits(
        ids,
        { left: 0, top: 3600, width: 600, height: 3600 },
        600,
        1,
        36,
      ),
    ).toHaveLength(100));
  it("replaces, adds and toggles against the gesture's initial selection", () => {
    expect(mergeMarquee(["a", "b"], ["b", "c"], "replace")).toEqual(["b", "c"]);
    expect(mergeMarquee(["a", "b"], ["b", "c"], "add")).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(mergeMarquee(["a", "b"], ["b", "c"], "toggle")).toEqual(["a", "c"]);
  });
});
describe("local directory preference", () => {
  it("restores a successful local directory without a Windows extended-path prefix", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) || null,
      setItem: (key: string, value: string) => data.set(key, value),
    });
    saveLocalDirectory("\\\\?\\D:\\项目资料");
    expect(readLocalDirectory()).toBe("D:\\项目资料");
    saveLocalDirectory(":computer:");
    expect(readLocalDirectory()).toBe(":computer:");
  });
  it("ignores invalid preferences and unavailable storage", () => {
    vi.stubGlobal("localStorage", { getItem: () => "{broken" });
    expect(readLocalDirectory()).toBe("");
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify({ path: "D:\\" }),
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(readLocalDirectory()).toBe("");
    expect(() => saveLocalDirectory("D:\\")).not.toThrow();
  });
});
