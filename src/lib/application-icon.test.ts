import { afterEach, describe, expect, it, vi } from "vitest"

import { applyApplicationIcon, APPLICATION_ICON_STORAGE_KEY, getApplicationIconPreference, readStoredApplicationIcon, resolveApplicationIcon, saveApplicationIconPreference } from "@/lib/application-icon"
import { setApplicationIcon } from "@/lib/bridge"

vi.mock("@/lib/bridge", () => ({ setApplicationIcon: vi.fn().mockResolvedValue(undefined) }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe("application icon preference", () => {
  it.each(["light", "dark", "mono"] as const)("restores the %s icon", (icon) => {
    expect(readStoredApplicationIcon(icon)).toBe(icon)
  })

  it.each([null, "", "unknown", "system"])("defaults %s to system", (value) => {
    expect(readStoredApplicationIcon(value)).toBe("system")
  })

  it("resolves the system preference from the current color scheme", () => {
    expect(resolveApplicationIcon("system", false)).toBe("light")
    expect(resolveApplicationIcon("system", true)).toBe("dark")
  })

  it("keeps explicit icon variants independent from the color scheme", () => {
    expect(resolveApplicationIcon("light", true)).toBe("light")
    expect(resolveApplicationIcon("dark", false)).toBe("dark")
    expect(resolveApplicationIcon("mono", false)).toBe("mono")
  })

  it("persists only the icon preference in OriaTunnel's own namespace and notifies subscribers", () => {
    const values = new Map<string, string>()
    const dispatchEvent = vi.fn()
    vi.stubGlobal("window", { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }, dispatchEvent })
    expect(getApplicationIconPreference()).toBe("system")
    saveApplicationIconPreference("mono")
    expect(values.get(APPLICATION_ICON_STORAGE_KEY)).toBe("mono")
    expect(APPLICATION_ICON_STORAGE_KEY).toBe("oria-tunnel.application-icon.v1")
    expect(getApplicationIconPreference()).toBe("mono")
    expect(dispatchEvent.mock.calls[0][0].type).toBe("oria-tunnel:application-icon-change")
  })

  it("does not invoke native APIs in the browser preview", async () => {
    vi.stubGlobal("window", {})
    await applyApplicationIcon("system", true)
    expect(setApplicationIcon).not.toHaveBeenCalled()
  })

  it("keeps rapid changes ordered and continues after a failed native update", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} })
    let release!: () => void
    vi.mocked(setApplicationIcon).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
      .mockRejectedValueOnce(new Error("native failure"))
    const first = applyApplicationIcon("system", true)
    const second = applyApplicationIcon("mono", false)
    const failed = expect(second).rejects.toThrow("native failure")
    const last = applyApplicationIcon("light", true)
    await vi.waitFor(() => expect(setApplicationIcon).toHaveBeenCalledTimes(1))
    expect(setApplicationIcon).toHaveBeenNthCalledWith(1, "dark")
    release()
    await Promise.all([first, failed, last])
    expect(vi.mocked(setApplicationIcon).mock.calls.map(([icon]) => icon)).toEqual(["dark", "mono", "light"])
  })
})
