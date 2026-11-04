import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import "@/i18n";
import { FilePathNavigation } from "./file-path-navigation";
import { FileSearchButton } from "./file-search-button";

describe("compact file navigation", () => {
  it("collapses intermediate directories while keeping this computer and the final hierarchy", () => {
    const html = renderToStaticMarkup(
      <FilePathNavigation
        path="D:\\Projects\\OriaTunnel\\src\\features\\files"
        remote={false}
        disabled={false}
        loading={false}
        onNavigate={async () => true}
      />,
    );
    expect(html).toContain('data-slot="breadcrumb-ellipsis"');
    expect(html).toContain("此电脑");
    expect(html).toContain(">features</button>");
    expect(html).toContain(">files</button>");
    expect(html).not.toContain(">Projects</button>");
    expect(html).toContain("输入完整路径");
  });
  it("keeps a remote root and avoids an overflow menu for short paths", () => {
    const html = renderToStaticMarkup(
      <FilePathNavigation
        path="/home/user"
        remote
        disabled={false}
        loading={false}
        onNavigate={async () => true}
      />,
    );
    expect(html).toContain(">/</button>");
    expect(html).not.toContain("此电脑");
    expect(html).not.toContain('data-slot="breadcrumb-ellipsis"');
  });
  it("starts search collapsed and retains a visible filtered state without mounting the field", () => {
    const html = renderToStaticMarkup(
      <FileSearchButton value="report" onChange={() => {}} />,
    );
    expect(html).toContain('data-filtered="true"');
    expect(html).toContain('aria-label="筛选当前目录"');
    expect(html).toContain("report");
    expect(html).not.toContain('type="search"');
  });
});
