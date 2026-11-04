export const filePanelModes = ["auto", "columns", "rows", "split"] as const;
export type FilePanelMode = (typeof filePanelModes)[number];
export type FilePanelLayout = Exclude<FilePanelMode, "auto">;
export type FilePanelRatios = { browser: number; local: number };
export type FilePanelPreferences = {
  mode: FilePanelMode;
  ratios: Partial<Record<FilePanelLayout, FilePanelRatios>>;
};
export const FILE_PANEL_LAYOUT_KEY = "oria-tunnel.files-panel-layout.v1";

export function automaticFileLayout(
  width: number,
  height: number,
  previous?: FilePanelLayout,
): FilePanelLayout {
  if (
    !(
      width > 0 &&
      height > 0 &&
      Number.isFinite(width) &&
      Number.isFinite(height)
    )
  )
    return previous || "split";
  const ratio = width / height;
  // Keep small resize movements around a boundary from flipping the axes repeatedly.
  if (previous === "columns" && ratio >= 1.65) return "columns";
  if (previous === "rows" && ratio <= 0.9) return "rows";
  if (ratio >= 1.8) return "columns";
  if (ratio <= 0.8) return "rows";
  return "split";
}

export function filePanelOrientations(layout: FilePanelLayout) {
  return {
    outer:
      layout === "columns" ? ("horizontal" as const) : ("vertical" as const),
    inner: layout === "rows" ? ("vertical" as const) : ("horizontal" as const),
  };
}
export function filePanelRatios(
  preferences: FilePanelPreferences,
  layout: FilePanelLayout,
): FilePanelRatios {
  return (
    preferences.ratios[layout] || {
      browser: layout === "split" ? 70 : (100 * 2) / 3,
      local: 50,
    }
  );
}
export function readFilePanelPreferences(): FilePanelPreferences {
  const fallback: FilePanelPreferences = { mode: "auto", ratios: {} };
  try {
    const raw = localStorage.getItem(FILE_PANEL_LAYOUT_KEY);
    if (!raw) {
      const legacy = JSON.parse(
        localStorage.getItem("oria-tunnel.files-layout") || "null",
      );
      if (
        legacy &&
        Number.isFinite(legacy.local) &&
        Number.isFinite(legacy.remote) &&
        legacy.local >= 25 &&
        legacy.remote >= 25
      ) {
        const sum = legacy.local + legacy.remote;
        if (!Number.isFinite(sum)) return fallback;
        const local = Math.max(20, Math.min(80, (100 * legacy.local) / sum));
        for (const layout of ["columns", "rows", "split"] as const)
          fallback.ratios[layout] = {
            browser: layout === "split" ? 70 : (100 * 2) / 3,
            local,
          };
      }
      return fallback;
    }
    const value = JSON.parse(raw);
    if (filePanelModes.includes(value?.mode)) fallback.mode = value.mode;
    for (const layout of ["columns", "rows", "split"] as const) {
      const ratios = value?.ratios?.[layout];
      if (
        ratios &&
        Number.isFinite(ratios.browser) &&
        ratios.browser >= 35 &&
        ratios.browser <= 80 &&
        Number.isFinite(ratios.local) &&
        ratios.local >= 20 &&
        ratios.local <= 80
      )
        fallback.ratios[layout] = {
          browser: ratios.browser,
          local: ratios.local,
        };
    }
  } catch {
    /* A blocked or corrupt preference cannot prevent opening files. */
  }
  return fallback;
}
export function saveFilePanelPreferences(value: FilePanelPreferences) {
  try {
    localStorage.setItem(FILE_PANEL_LAYOUT_KEY, JSON.stringify(value));
  } catch {
    /* Session changes remain usable. */
  }
}
