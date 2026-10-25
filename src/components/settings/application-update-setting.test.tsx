import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "@/i18n";
import { ApplicationUpdateSetting } from "./application-update-setting";
import {
  acceptUpdateSnapshot,
  type useApplicationUpdate,
} from "@/lib/application-update";
import type { UpdateSnapshot } from "@/types";

vi.mock("@/lib/bridge", () => ({ desktop: true }));

const initial: UpdateSnapshot = {
  revision: 1,
  currentVersion: "0.1.0",
  phase: "idle",
  unavailable: null,
  autoCheck: true,
  preferenceError: false,
  release: null,
  downloaded: 0,
  total: null,
  error: null,
  canDownload: false,
  canInstall: false,
};
function render(patch: Partial<UpdateSnapshot> = {}, showVersion = true) {
  const updates: ReturnType<typeof useApplicationUpdate> = {
    snapshot: { ...initial, ...patch },
    pending: false,
    error: null,
    refresh: vi.fn(),
    check: vi.fn(),
    download: vi.fn(),
    autoCheck: vi.fn(),
    context: vi.fn(),
    install: vi.fn(),
  };
  return renderToStaticMarkup(
    <ApplicationUpdateSetting updates={updates} showVersion={showVersion} />,
  );
}
afterEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

describe("application updates", () => {
  it("shows only actual check results and includes the available version once", () => {
    const idle = render();
    expect(idle).toContain("当前版本：0.1.0");
    expect(idle.match(/0\.1\.0/g)).toHaveLength(1);
    expect(render({}, false)).toContain("当前版本：0.1.0");
    expect(idle).not.toContain("可以检查更新");
    expect(idle).not.toContain("已是最新版本");
    expect(idle).not.toContain("下载和安装均需确认");
    expect(idle).not.toContain("更新状态");
    const available = render({
      phase: "available",
      canDownload: true,
      release: { version: "0.2.0", notes: "" },
    });
    expect(available).toContain("有新版本 0.2.0 可用");
    expect(available.match(/0\.2\.0/g)).toHaveLength(1);
    expect(render({ phase: "upToDate" })).toContain("已是最新版本");
  });
  it("rejects stale progress and preserves the newer terminal state", () => {
    const ready = {
      ...initial,
      revision: 5,
      phase: "ready" as const,
      canInstall: true,
    };
    expect(
      acceptUpdateSnapshot(ready, {
        ...initial,
        revision: 4,
        phase: "downloading",
      }),
    ).toBe(ready);
    expect(acceptUpdateSnapshot(null, ready)).toBe(ready);
  });
  it("uses one primary action that follows the backend update state", () => {
    const release = { version: "0.2.0", notes: "" };
    const available = render({
      phase: "available",
      release,
      canDownload: true,
    });
    expect(available.match(/>下载更新<\/button>/g)).toHaveLength(1);
    expect(available).not.toContain(">检查更新</button>");
    const ready = render({ phase: "ready", release, canInstall: true });
    expect(ready.match(/>安装并重启<\/button>/g)).toHaveLength(1);
    expect(ready).not.toContain(">检查更新</button>");
    const downloading = render({ phase: "downloading", release });
    expect(downloading).toMatch(/<button[^>]*disabled[^>]*>下载更新<\/button>/);
  });
  it("uses labeled Progress with determinate and indeterminate values without announcing each chunk", () => {
    const unknown = render({ phase: "downloading", downloaded: 512 });
    expect(unknown).toContain('data-slot="progress"');
    expect(unknown).toContain('role="progressbar"');
    expect(unknown).toContain('aria-label="更新下载进度"');
    expect(unknown).toContain("data-indeterminate");
    expect(unknown).not.toContain("aria-valuenow");
    expect(unknown).not.toContain('data-slot="progress-value"');
    const known = render({
      phase: "downloading",
      downloaded: 512,
      total: 1024,
    });
    expect(known).toContain('aria-valuemax="1024"');
    expect(known).toContain('aria-valuenow="512"');
    expect(known).toContain('data-slot="progress-indicator"');
    expect(known).toMatch(/data-slot="progress-value"[^>]*>50%<\/span>/);
    expect(known).toContain('aria-live="off"');
    expect(known).toContain('role="status"');
    expect(known).not.toContain("停止会话并安装");
  });
  it("escapes release notes and keeps a failed download retryable without offering installation", () => {
    const html = render({
      phase: "error",
      error: "download",
      canDownload: true,
      release: {
        version: "0.2.0",
        notes: '<script>alert("untrusted")</script>',
      },
    });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("下载更新");
    expect(html).not.toContain(">安装并重启<");
    expect(html).toContain('role="alert"');
  });
  it("explains unavailability and disables checking in unconfigured and development builds", () => {
    for (const unavailable of [
      "notConfigured",
      "development",
      "unsupported",
    ] as const) {
      const html = render({ unavailable });
      expect(html).toContain(
        i18n.t(`unavailable.${unavailable}`, { ns: "updater" }),
      );
      expect(html).toMatch(/<button[^>]*disabled[^>]*>检查更新<\/button>/);
    }
  });
  it("has complete translated keys and interpolation in all eight languages", async () => {
    const flatten = (value: object, prefix = ""): Record<string, string> =>
      Object.fromEntries(
        Object.entries(value).flatMap(([key, child]) =>
          typeof child === "string"
            ? [[prefix + key, child]]
            : Object.entries(flatten(child, `${prefix}${key}.`)),
        ),
      );
    const english = flatten(i18n.getResourceBundle("en", "updater"));
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
      const messages = flatten(i18n.getResourceBundle(language, "updater"));
      const baseKeys = (keys: string[]) =>
        [
          ...new Set(
            keys.map((key) =>
              key.replace(/_(zero|one|two|few|many|other)$/, ""),
            ),
          ),
        ].sort();
      expect(baseKeys(Object.keys(messages))).toEqual(
        baseKeys(Object.keys(english)),
      );
      for (const [key, value] of Object.entries(messages)) {
        expect(value.trim()).not.toBe("");
        expect(value.match(/{{\w+}}/g) || []).toEqual(
          english[key.replace(/_(zero|one|two|few|many|other)$/, "")].match(
            /{{\w+}}/g,
          ) || [],
        );
      }
      await i18n.changeLanguage(language);
      const html = render({
        phase: "ready",
        canInstall: true,
        release: { version: "0.2.0", notes: "Fixture notes" },
      });
      expect(html).toContain(i18n.t("title", { ns: "updater" }));
      expect(html).toContain("0.2.0");
      expect(html).not.toContain("{{");
    }
  });
});
