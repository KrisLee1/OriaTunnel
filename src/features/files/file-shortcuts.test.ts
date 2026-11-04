import { describe, expect, it } from "vitest";
import { fileShortcut } from "./file-shortcuts";

const key = (key: string, modifiers: Partial<KeyboardEvent> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  defaultPrevented: false,
  ...modifiers,
});

describe("file grid platform shortcuts", () => {
  it("uses Finder Return, Command+Down/Up and Command+Backspace on Mac", () => {
    expect(fileShortcut(key("Enter"), true)).toBe("rename");
    expect(fileShortcut(key("ArrowDown", { metaKey: true }), true)).toBe(
      "open",
    );
    expect(fileShortcut(key("ArrowUp", { metaKey: true }), true)).toBe(
      "parent",
    );
    expect(fileShortcut(key("Backspace", { metaKey: true }), true)).toBe(
      "delete",
    );
    expect(fileShortcut(key("Backspace"), true)).toBeUndefined();
    expect(fileShortcut(key("Delete"), true)).toBeUndefined();
  });
  it("preserves Windows Enter, Delete and F2 without treating Meta as Control", () => {
    expect(fileShortcut(key("Enter"), false)).toBe("open");
    expect(fileShortcut(key("Delete"), false)).toBe("delete");
    expect(fileShortcut(key("F2"), false)).toBe("rename");
    expect(
      fileShortcut(key("Backspace", { metaKey: true }), false),
    ).toBeUndefined();
    expect(fileShortcut(key("a", { metaKey: true }), false)).toBeUndefined();
  });
  it("copies paths and selects all with the platform modifier, including uppercase keys", () => {
    for (const mac of [true, false]) {
      const modifier = mac ? { metaKey: true } : { ctrlKey: true };
      expect(fileShortcut(key("A", modifier), mac)).toBe("selectAll");
      expect(fileShortcut(key("c", modifier), mac)).toBe("copyPath");
      expect(fileShortcut(key(" "), mac)).toBe("open");
    }
  });
  it("leaves IME, handled events and other modifier combinations alone", () => {
    for (const mac of [true, false]) {
      for (const modifier of [
        { isComposing: true },
        { defaultPrevented: true },
        { altKey: true },
        { shiftKey: true },
      ]) {
        expect(fileShortcut(key("Enter", modifier), mac)).toBeUndefined();
      }
      expect(
        fileShortcut(key("a", { ctrlKey: true, metaKey: true }), mac),
      ).toBeUndefined();
    }
  });
});
