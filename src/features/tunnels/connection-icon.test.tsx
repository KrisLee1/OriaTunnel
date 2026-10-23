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
