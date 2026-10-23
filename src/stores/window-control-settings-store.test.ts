import { describe, expect, it } from "vitest"

import {
  resolveWindowControlPosition,
  resolveSystemWindowControlStyle,
  resolveWindowControlStyle,
} from "@/stores/window-control-settings-store"

describe("window control style resolution", () => {
  it("uses Windows controls for Windows platform signals", () => {
    expect(resolveSystemWindowControlStyle("Win32", "Mozilla/5.0")).toBe("windows")
  })

  it("uses macOS controls for macOS platform signals", () => {
    expect(resolveSystemWindowControlStyle("MacIntel", "Mozilla/5.0 Macintosh")).toBe("macos")
    expect(resolveSystemWindowControlStyle("Darwin", "WebKit")).toBe("macos")
  })

  it("keeps an explicitly selected style", () => {
    expect(resolveWindowControlStyle("macos")).toBe("macos")
    expect(resolveWindowControlStyle("windows")).toBe("windows")
  })

  it("follows the system position only while the style follows the system", () => {
    expect(resolveWindowControlPosition("system", "right", "macos")).toBe("left")
    expect(resolveWindowControlPosition("system", "left", "windows")).toBe("right")
    expect(resolveWindowControlPosition("macos", "right", "macos")).toBe("right")
  })
})
