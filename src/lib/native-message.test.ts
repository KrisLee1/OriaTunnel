import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { supportedLanguages } from "@/i18n-resources";
import { formatNativeMessage, nativeMessageKey } from "./native-message";

function message(key: string, args = {}, fallback = "Readable fallback") {
  return `oria-message:${JSON.stringify({ v: 1, key, args, fallback })}`;
}
afterEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

describe("native message rendering", () => {
  it.each(supportedLanguages)(
    "keeps raw paths and external errors literal in %s",
    async (language) => {
      await i18n.changeLanguage(language);
      const error =
        "library error {{file}} $t(ruleMissing) <script>alert(1)</script>";
      const file = "C:\\folder with spaces\\配置:source";
      const raw = message("sshFileLine", { file, line: 17, error });
      expect(formatNativeMessage(raw)).toBe(`${file}:17: ${error}`);
      expect(nativeMessageKey(raw)).toBe("sshFileLine");
      expect(formatNativeMessage(error)).toBe(error);
    },
  );
  it("translates only explicit nested arguments and re-renders existing state", async () => {
    const literal = message("ruleMissing");
    const raw = message("jumpNeedsAttention", {
      arg0: literal,
      arg1: { message: message("hostSourceMissing") },
    });
    await i18n.changeLanguage("en");
    expect(formatNativeMessage(raw)).toBe(
      `Jump host ${literal} needs attention: The host source is unavailable`,
    );
    await i18n.changeLanguage("zh-CN");
    expect(formatNativeMessage(raw)).toBe(
      `跳板 ${literal} 需处理: 主机来源失效`,
    );
  });
  it("retains unknown-message fallback text without interpreting its literal tokens", async () => {
    await i18n.changeLanguage("en");
    const fallback = "literal {{file}} $t(ruleMissing)";
    expect(
      formatNativeMessage(
        message("futureMessage", { file: "unwanted substitution" }, fallback),
      ),
    ).toBe(fallback);
    const malformed = 'oria-message:{"v":2,"key":"ruleMissing"}';
    expect(formatNativeMessage(malformed)).toBe(malformed);
  });
  it("renders a large diagnostic list and preserves readable fallbacks after the budget", async () => {
    await i18n.changeLanguage("en");
    const messages = Array.from({ length: 22000 }, () =>
      message("sshPortInvalid", {}, "SSH 端口无效"),
    );
    const raw = `oria-message:${JSON.stringify({ v: 1, messages, separator: "\n", fallback: "List fallback" })}`;
    const rendered = formatNativeMessage(raw);
    expect(rendered.split("\n")).toHaveLength(22000);
    expect(rendered.startsWith("The SSH port is invalid")).toBe(true);
    expect(rendered.endsWith("SSH 端口无效")).toBe(true);
    expect(rendered).not.toContain("oria-message:");
  });
});
