import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { formatUiError } from "./ui-message";

const previous = i18n.language;
afterEach(async () => {
  await i18n.changeLanguage(previous);
});

describe("localized error rendering", () => {
  it("retranslates stored error identifiers and native envelopes when language changes", async () => {
    const native =
      "oria-message:" +
      JSON.stringify({
        v: 1,
        key: "configRead",
        args: { e: "C:\\SSH files\\{{literal}}: denied" },
        fallback: "read failed",
      });
    for (const language of [
      "zh-CN",
      "zh-TW",
      "en",
      "ja",
      "ko",
      "de",
      "fr",
      "ru",
    ]) {
      await i18n.changeLanguage(language);
      const t = i18n.getFixedT(language, "terminal");
      expect(formatUiError("authentication", t)).toBe(
        t("error.authentication"),
      );
      expect(formatUiError("error.inputLimit", t)).toBe(t("error.inputLimit"));
      const rendered = formatUiError(native, t);
      expect(rendered).toContain("C:\\SSH files\\{{literal}}: denied");
      expect(rendered).not.toContain("oria-message:");
    }
  });
  it("keeps external errors literal and supports an explicitly selected error namespace", () => {
    const t = i18n.getFixedT("en", "tunnel");
    const external = "C:\\SSH files\\host.conf:12: unknown option {{name}}";
    expect(formatUiError(external, t)).toBe(external);
    expect(formatUiError("staleAction", t, "commands")).toBe(
      i18n.t("error.staleAction", { lng: "en", ns: "commands" }),
    );
    expect(formatUiError("importFileSize", t, "commands")).toBe(
      t("importFileSize"),
    );
  });
});
