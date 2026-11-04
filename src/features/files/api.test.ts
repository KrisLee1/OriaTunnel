import { describe, it, expect, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { api, breadcrumbs, selection, sorted, type Entry } from "./api";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));
describe("file browser model", () => {
  it("hides Windows hidden/system attributes by default and reveals them with the existing toggle", () => {
    const entries = [
      {
        id: "system",
        name: "System Volume Information",
        kind: "directory",
        hidden: true,
      },
      { id: "recycle", name: "$RECYCLE.BIN", kind: "directory", hidden: true },
      { id: "normal", name: "$normal", kind: "directory", hidden: false },
      { id: "dot", name: ".config", kind: "file" },
    ] as Entry[];
    expect(sorted(entries, "", false, "name").map((e) => e.id)).toEqual([
      "normal",
    ]);
    expect(sorted(entries, "", true, "name")).toHaveLength(4);
    expect(sorted(entries, "recycle", false, "name")).toHaveLength(0);
  });
  it("opens a recorded local transfer folder by task, selected source and endpoint rather than an arbitrary path", async () => {
    await api.openTransferFolder("task", {
      source: "/selected/file.txt",
      side: "target",
    });
    expect(invoke).toHaveBeenLastCalledWith("file_open_transfer_folder", {
      id: "task",
      source: "/selected/file.txt",
      side: "target",
    });
  });
  it("uses the dedicated conflict command with an explicit single-file or task-wide choice", async () => {
    await api.resolveConflict("task", "skip", false, "target", "source");
    expect(invoke).toHaveBeenLastCalledWith("file_resolve_conflict", {
      id: "task",
      policy: "skip",
      applyAll: false,
      session: "target",
      sourceSession: "source",
    });
    await api.resolveConflict("task", "replace", true);
    expect(invoke).toHaveBeenLastCalledWith("file_resolve_conflict", {
      id: "task",
      policy: "replace",
      applyAll: true,
      session: undefined,
      sourceSession: undefined,
    });
  });
  it.each(["name", "type", "size", "modified"])(
    "reverses the complete %s order including the folder group",
    (sort) => {
      const entries = [
        {
          id: "folder",
          name: "folder",
          kind: "directory",
          size: 0,
          modified: 0,
        },
        { id: "a", name: "a.csv", kind: "file", size: 1, modified: 1 },
        { id: "b", name: "b.txt", kind: "file", size: 2, modified: 2 },
      ] as Entry[];
      expect(sorted(entries, "", true, sort, false).map((e) => e.id)).toEqual([
        "folder",
        "a",
        "b",
      ]);
      expect(sorted(entries, "", true, sort, true).map((e) => e.id)).toEqual([
        "b",
        "a",
        "folder",
      ]);
    },
  );
  it("sorts by file extension without case sensitivity, preserving folders first and name ties", () => {
    const entries = [
      { id: "z", name: "z.TXT", kind: "file" },
      { id: "folder", name: "data.zip", kind: "directory" },
      { id: "a", name: "a.txt", kind: "file" },
      { id: "png", name: "image.png", kind: "file" },
      { id: "none", name: "README", kind: "file" },
    ] as Entry[];
    expect(sorted(entries, "", true, "type").map((e) => e.id)).toEqual([
      "folder",
      "none",
      "png",
      "a",
      "z",
    ]);
  });
  it("creates navigable breadcrumbs for remote, drive, UNC and POSIX roots", () => {
    expect(breadcrumbs(":computer:", false)).toEqual([]);
    expect(breadcrumbs("/home/user/models", true).map((c) => c.path)).toEqual([
      "/",
      "/home",
      "/home/user",
      "/home/user/models",
    ]);
    expect(breadcrumbs("C:\\Users\\test", false).map((c) => c.path)).toEqual([
      "C:\\",
      "C:\\Users",
      "C:\\Users\\test",
    ]);
    expect(
      breadcrumbs("\\\\server\\share\\docs", false).map((c) => c.path),
    ).toEqual(["\\\\server\\share", "\\\\server\\share\\docs"]);
    expect(breadcrumbs("/", true)).toEqual([{ label: "/", path: "/" }]);
  });
  it("range and toggle selection use visible stable IDs", () => {
    expect(selection(["a"], "c", ["a", "b", "c"], false, true, "a")).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(selection(["a", "b"], "a", ["a", "b"], true, false)).toEqual(["b"]);
  });
  it("filters current directory without including hidden selections and keeps folders first", () => {
    const files = [
      { id: "a", name: "large", kind: "file", size: 5 },
      { id: "b", name: "small", kind: "directory", size: 0 },
      { id: "c", name: ".hidden", kind: "file", size: 9 },
    ] as Entry[];
    expect(sorted(files, "", false, "size").map((f) => f.id)).toEqual([
      "b",
      "a",
    ]);
    expect(sorted(files, "hidden", true, "name").map((f) => f.id)).toEqual([
      "c",
    ]);
  });
});
