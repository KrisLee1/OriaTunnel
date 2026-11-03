import { describe, it, expect } from "vitest";
import { breadcrumbs, selection, sorted, type Entry } from "./api";
describe("file browser model", () => {
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
