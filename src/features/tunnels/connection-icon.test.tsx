import brands from "@/assets/service-icons.json";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "@/i18n";
import "@/tunnel-i18n";
import {
  ConnectionIcon,
  ConnectionIconPicker,
  connectionIconCatalog,
  validCustomIcon,
} from "./connection-icon";

describe("forward icons", () => {
  it("renders every catalog icon and accepts all emoji plus composite custom symbols", () => {
    expect(connectionIconCatalog.icons.length).toBeGreaterThanOrEqual(50);
    expect(connectionIconCatalog.emojis.length).toBeGreaterThanOrEqual(70);
    expect(new Set(connectionIconCatalog.icons.map((i) => i.id)).size).toBe(
      connectionIconCatalog.icons.length,
    );
    for (const icon of connectionIconCatalog.icons) {
      const html = renderToStaticMarkup(
        <ConnectionIcon
          icon={{ kind: "builtin", value: icon.id }}
          color="#abcdef"
        />,
      );
      expect(html).toContain("<svg");
      expect(html).toContain("#abcdef");
    }
    for (const value of [
      ...connectionIconCatalog.emojis.map((i) => i.value),
      "👩🏽‍💻",
      "🇨🇳",
      "★",
      "1️⃣",
    ])
      expect(validCustomIcon(value), value).toBe(true);
    for (const value of [
      "",
      " ",
      "🚀🚀",
      "hello",
      "\n",
      "\u202e",
      "\u200d",
      "\ufe0f",
      "https://example.invalid/icon.svg",
    ])
      expect(validCustomIcon(value), value).toBe(false);
  });
  it("keeps service brand choices aligned with local paths and inherits the selected color", () => {
    expect(
      new Set(
        connectionIconCatalog.icons
          .filter((i) => i.category === "service")
          .map((i) => i.id),
      ),
    ).toEqual(new Set(Object.keys(brands.icons)));
    for (const [id, asset] of Object.entries(brands.icons)) {
      const html = renderToStaticMarkup(
        <ConnectionIcon
          icon={{ kind: "builtin", value: id }}
          color="#123abc"
        />,
      );
      expect(html).toContain('fill="currentColor"');
      expect(html).toContain(asset.paths[0]);
      expect(html).not.toContain("<img");
      expect(html).not.toContain("href=");
    }
  });
  it("uses the official DSH fish geometry and its original aspect ratio", () => {
    expect(brands.icons.dsh.source).toContain(
      "deepseek-ai/deepseek-harness/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/",
    );
    const html = renderToStaticMarkup(
      <ConnectionIcon
        icon={{ kind: "builtin", value: "dsh" }}
        color="#123abc"
      />,
    );
    expect(html).toContain('viewBox="0 0 23.16 17.04"');
    expect(html).toContain(brands.icons.dsh.paths[0]);
    expect(html).not.toContain("lucide-bot");
  });
  it("keeps the default colored dot and safely renders custom text", () => {
    expect(renderToStaticMarkup(<ConnectionIcon color="#abcdef" />)).toContain(
      "connection-color-dot",
    );
    expect(
      renderToStaticMarkup(
        <ConnectionIcon icon={{ kind: "emoji", value: "<" }} color={null} />,
      ),
    ).toContain("&lt;");
    expect(
      renderToStaticMarkup(
        <ConnectionIcon
          icon={{ kind: "builtin", value: "missing" }}
          color={null}
        />,
      ),
    ).toContain("connection-color-dot");
  });
  it("uses a non-submitting collapsed trigger and the requested field name in both languages", async () => {
    const previous = i18n.language;
    try {
      for (const [language, label] of [
        ["zh-CN", "图标"],
        ["en", "Icon"],
      ]) {
        await i18n.changeLanguage(language);
        const html = renderToStaticMarkup(
          <ConnectionIconPicker
            value={{ kind: "emoji", value: "🚀" }}
            color={null}
            onChange={() => {}}
          />,
        );
        expect(html).toContain(`>${label}</span>`);
        expect(html).toContain('aria-expanded="false"');
        expect(html).toContain('type="button"');
        expect(html).toContain("🚀");
        expect(html).not.toContain("转发图标");
      }
    } finally {
      await i18n.changeLanguage(previous);
    }
  });
});
