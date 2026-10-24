import { describe, expect, it, vi } from "vitest";
import { installWebviewGuards, isWebviewDebugShortcut } from "./webview-guards";

const shortcut = (key: string, modifiers = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

describe("production WebView interaction", () => {
  it("allows the terminal's application menu keys without enabling native menus or debugging", () => {
    class TestElement extends EventTarget {
      insideTerminal = true;
      insideMenu = false;
      closest(selector: string) {
        return (this.insideTerminal && selector === "[data-ssh-terminal]") ||
          (this.insideMenu && selector === "[data-ssh-terminal-menu]")
          ? this
          : null;
      }
    }
    vi.stubGlobal("Element", TestElement);
    try {
      const target = new TestElement();
      const release = installWebviewGuards(target as unknown as Document, true);
      const send = (type: string, key: string, modifiers = {}) => {
        const event = Object.assign(
          new Event(type, { cancelable: true }),
          shortcut(key, modifiers),
        );
        target.dispatchEvent(event);
        return event.defaultPrevented;
      };
      expect(send("keydown", "ContextMenu")).toBe(false);
      expect(send("keydown", "F10", { shiftKey: true })).toBe(false);
      expect(send("keydown", "F12")).toBe(true);
      expect(send("keydown", "i", { ctrlKey: true, shiftKey: true })).toBe(
        true,
      );
      expect(send("contextmenu", "")).toBe(true);
      target.insideTerminal = false;
      expect(send("keydown", "ContextMenu")).toBe(true);
      expect(send("keydown", "F10", { shiftKey: true })).toBe(true);
      target.insideMenu = true;
      expect(send("keydown", "c", { ctrlKey: true, shiftKey: true })).toBe(
        false,
      );
      expect(send("keydown", "F10", { shiftKey: true })).toBe(false);
      expect(send("keydown", "u", { ctrlKey: true })).toBe(true);
      expect(send("keydown", "F12")).toBe(true);
      expect(send("keydown", "i", { ctrlKey: true, shiftKey: true })).toBe(
        true,
      );
      release();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("blocks inspection/source/menu entry points while keeping edit and app shortcuts", () => {
    for (const event of [
      shortcut("F12"),
      shortcut("ContextMenu"),
      shortcut("F10", { shiftKey: true }),
      ...["i", "j", "c"].flatMap((key) => [
        shortcut(key, { ctrlKey: true, shiftKey: true }),
        shortcut(key, { metaKey: true, altKey: true }),
      ]),
      shortcut("u", { ctrlKey: true }),
      shortcut("u", { metaKey: true, altKey: true }),
    ])
      expect(isWebviewDebugShortcut(event)).toBe(true);
    for (const event of [
      shortcut("c", { metaKey: true }),
      shortcut("v", { ctrlKey: true }),
      shortcut("a", { metaKey: true }),
      shortcut("z", { metaKey: true }),
      shortcut("r", { metaKey: true }),
      shortcut("Tab"),
      shortcut("Enter"),
      shortcut("Escape"),
    ])
      expect(isWebviewDebugShortcut(event)).toBe(false);
  });
  it("installs only in production and can remove listeners", () => {
    const target = new EventTarget();
    const send = (type: string, key = "") => {
      const event = Object.assign(
        new Event(type, { cancelable: true }),
        shortcut(key),
      );
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const release = installWebviewGuards(target as unknown as Document, true);
    expect(send("contextmenu")).toBe(true);
    expect(send("keydown", "F12")).toBe(true);
    expect(send("keydown", "Enter")).toBe(false);
    release();
    expect(send("contextmenu")).toBe(false);
    const development = installWebviewGuards(
      target as unknown as Document,
      false,
    );
    expect(send("keydown", "F12")).toBe(false);
    development();
  });
});
