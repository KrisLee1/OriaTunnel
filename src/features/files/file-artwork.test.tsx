import "@/i18n";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FileArtwork, fileCategory } from "./file-artwork";
import { TransferItem } from "./transfer-item";
import type { Task } from "./api";

describe("shared file artwork", () => {
  it.each([
    ["报告.PDF", "file", "pdf"],
    ["data.csv", "file", "table"],
    ["README", "file", "document"],
    ["课件.pptx", "file", "slides"],
    ["image.webp", "file", "image"],
    ["song.flac", "file", "audio"],
    ["movie.mkv", "file", "video"],
    ["/home/.env.production", "file", "code"],
    ["C:\\project\\main.rs", "file", "code"],
    ["backup.tar.gz", "file", "archive"],
    ["unknown", "file", "file"],
    ["folder.zip", "directory", "folder"],
    ["image.png", "link", "file"],
    ["D:\\", "drive", "drive"],
    ["", "batch", "batch"],
  ])("classifies %s from its real kind and name", (name, kind, category) => {
    expect(fileCategory(name, kind)).toBe(category);
  });
  it("renders decorative layered folders, file sheets and explicit link/drive glyphs", () => {
    const render = (name: string, kind: string) =>
      renderToStaticMarkup(<FileArtwork name={name} kind={kind} large />);
    expect(render("folder", "directory")).toContain(
      "files-artwork-folder-front",
    );
    expect(render("report.pdf", "file")).toContain("files-artwork-sheet");
    expect(render("report.pdf", "file")).toContain(">PDF</text>");
    expect(render("ntuser.ini", "file")).toContain(">INI</text>");
    expect(render("unknown", "file")).toContain(">FILE</text>");
    expect(render("shortcut", "link")).toContain("lucide-arrow-up-right");
    expect(render("C:\\", "drive")).toContain("files-artwork-drive-body");
    expect(render("", "batch")).toContain("files-artwork-batch-middle");
    expect(render("folder", "directory")).toContain('aria-hidden="true"');
  });
  it("uses the same artwork at the far left of single-file, directory, batch and legacy transfer rows", () => {
    const base: Task = {
      id: "fixture",
      hostId: "host",
      hostName: "Fixture",
      sessionId: "session",
      direction: "upload",
      sources: ["/report.pdf"],
      target: "/dest",
      phase: "completed",
      bytes: 42,
      total: 42,
      count: 1,
      completed: ["/report.pdf"],
      skipped: 0,
      revision: 1,
      error: null,
      conflict: null,
      temp: null,
      started: 1,
      finished: 2,
      speed: null,
      eta: null,
    };
    const render = (change: Partial<Task>) =>
      renderToStaticMarkup(
        <TransferItem task={{ ...base, ...change }} onAction={() => {}} />,
      );
    expect(render({ sourceKinds: ["file"] })).toMatch(
      /files-transfer-row"[^>]*><span[^>]*files-transfer-artwork[^>]*data-category="pdf"/,
    );
    expect(
      render({ sources: ["/folder.zip"], sourceKinds: ["directory"] }),
    ).toContain('data-category="folder"');
    expect(
      render({ sources: ["/a.txt", "/b.pdf"], sourceKinds: ["file", "file"] }),
    ).toContain('data-category="batch"');
    expect(render({})).toContain('data-category="pdf"');
  });
});
