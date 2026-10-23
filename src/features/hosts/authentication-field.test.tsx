import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "@/i18n";
import "@/tunnel-i18n";
import { emptyHost } from "@/features/tunnels/rule-model";
import { AuthenticationField } from "./authentication-field";

afterEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

describe("authentication field", () => {
  it.each([
    ["zh-CN", "密码 / 私钥口令（可选）", "显示密码"],
    ["en", "Password / private key passphrase (optional)", "Show password"],
  ])("uses business translations and a non-submitting reveal button in %s", async (language, label, reveal) => {
    await i18n.changeLanguage(language);
    const html = renderToStaticMarkup(
      <AuthenticationField
        host={{ ...emptyHost(), id: "ui-fixture", name: "Fixture" }}
        value=""
        onChange={() => {}}
        remember={false}
        onRemember={() => {}}
      />,
    );
    expect(html).toContain(`Fixture · ${label}`);
    expect(html).toContain(`aria-label="${reveal}"`);
    expect(html).toContain('type="password"');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-pressed="false"');
    const inputId = html.match(/<input[^>]*id="([^"]+)"/)?.[1];
    expect(inputId).toBeTruthy();
    expect(html).toContain(`for="${inputId}"`);
    expect(html).toContain(`aria-controls="${inputId}"`);
  });
});
