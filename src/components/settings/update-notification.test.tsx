import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "@/i18n";
import { toast } from "@/components/ui/toast";
import { notifyApplicationUpdate } from "./update-notification";

afterEach(() => vi.restoreAllMocks());

describe("update notification", () => {
  it("shows the actual version in Badge and uses the transparent app logo", () => {
    const add = vi.spyOn(toast, "add").mockReturnValue("notification");
    notifyApplicationUpdate(
      "0.2.0",
      i18n.getFixedT("zh-CN", "updater"),
      vi.fn(),
    );
    const notification = add.mock.calls[0][0];
    const title = renderToStaticMarkup(<>{notification.title}</>);
    expect(title).toContain('data-slot="badge"');
    expect(title).toContain("0.2.0");
    expect(title).toContain("检测到新版本");
    expect(title).not.toContain("（");
    expect(title).not.toContain("关于中下载");
    const icon = renderToStaticMarkup(<>{notification.data?.icon}</>);
    expect(icon).toContain("oria-tunnel-logo.svg");
    expect(icon).toContain('aria-hidden="true"');
    expect(notification.actionProps?.children).toBe("去更新");
  });

  it("opens About and dismisses this notification when its action is pressed", () => {
    const add = vi.spyOn(toast, "add").mockReturnValue("notification");
    const close = vi.spyOn(toast, "close").mockImplementation(() => {});
    const openAbout = vi.fn();
    notifyApplicationUpdate(
      "0.2.0",
      i18n.getFixedT("zh-CN", "updater"),
      openAbout,
    );
    add.mock.calls[0][0].actionProps?.onClick?.({} as never);
    expect(openAbout).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith("application-update-0.2.0");
  });
});
