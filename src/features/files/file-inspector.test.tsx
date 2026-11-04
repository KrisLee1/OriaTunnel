import "@/i18n";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FilePropertiesContent, type FileTarget } from "./file-inspector";
import { FileCodePreview } from "./file-code-preview";
import { previewLanguage } from "./file-preview";
import { highlightCode } from "@/lib/highlighter";
import { Dialog } from "@/components/ui/dialog";
import { svgPreviewSource } from "./svg-preview-source";

const target: FileTarget = {
  entry: {
    id: "fixture",
    name: "<配置>.ini",
    kind: "file",
    size: 0,
    modified: 0,
    permissions: 0,
  },
  remote: false,
  path: "\\\\?\\C:\\项目\\<配置>.ini",
};
describe("file inspectors", () => {
  it("accepts standalone SVG XML declarations and editor comments without changing the source", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M0 0L20 20" /></svg>';
    expect(
      svgPreviewSource(
        '<?xml version="1.0" encoding="UTF-8"?>\n<!-- editor -->\n' + svg,
      ),
    ).toBe(svg);
  });
  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://example.invalid/image.svg#x"/></svg>',
    '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"></svg>',
  ])("rejects active or external standalone SVG content", (svg) => {
    expect(() => svgPreviewSource(svg)).toThrow();
  });
  it("shows selectable, aligned metadata, zero permissions and a clean complete path", () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <FilePropertiesContent target={target} />
      </Dialog>,
    );
    expect(html).toContain("&lt;配置&gt;.ini");
    expect(html).toContain("C:\\项目\\&lt;配置&gt;.ini");
    expect(html).not.toContain("\\\\?\\");
    expect(html).toContain("0 B");
    expect(html).toContain("000</dd>");
    expect(html).toContain("files-properties-path");
    expect(html).toContain('data-selectable="true"');
  });
  it("keeps directories distinct from files and unknown metadata explicit", () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <FilePropertiesContent
          target={{
            ...target,
            remote: true,
            hostName: "Fixture SSH",
            entry: { ...target.entry, kind: "directory", permissions: null },
          }}
        />
      </Dialog>,
    );
    expect(html).toContain('data-category="folder"');
    expect(html).toContain("Fixture SSH");
    expect(html).not.toContain("0 B");
    expect(html).toContain("—</dd>");
  });
  it.each([
    ["main.tsx", "tsx"],
    [".env.production", "ini"],
    [".bashrc", "bash"],
    ["report.txt", "text"],
    ["Dockerfile", "dockerfile"],
  ])("maps %s to %s", (name, language) =>
    expect(previewLanguage(name)).toBe(language),
  );
  it("bounds rendered source even for 100,000 lines, keeping plain text available before highlighting", () => {
    const code = Array.from(
      { length: 100_000 },
      (_, i) => `const row${i + 1} = ${i + 1};`,
    ).join("\n");
    const html = renderToStaticMarkup(
      <FileCodePreview code={code} language="typescript" />,
    );
    expect(
      (html.match(/data-slot="code-block-line"/g) || []).length,
    ).toBeLessThan(150);
    expect(html).toContain("const row1 = 1;");
    expect(html).not.toContain("const row100000 = 100000;");
    expect(html).toContain('data-slot="code-block-copy-button"');
  });
  it("highlights through theme variables and escapes previewed markup", async () => {
    const nodes = await highlightCode(
      'const source = "<script>alert(1)</script>";',
      "javascript",
    );
    const html = renderToStaticMarkup(<code>{nodes}</code>);
    expect(html).toContain("var(--oria-color-primary)");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(await highlightCode("<tag>", "unknown-language")).toBeNull();
  });
});
