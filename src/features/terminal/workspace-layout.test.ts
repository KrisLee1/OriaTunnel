import { describe, expect, it } from "vitest";
import {
  clampWorkspaceSize,
  parseWorkspaceLayout,
  resizeWorkspace,
  workspaceKeyboardSize,
  workspaceBounds,
  workspaceSizeLimit,
  workspaceChromeBottom,
  terminalTabScrollEdges,
} from "./workspace-layout";

describe("terminal workspace docking", () => {
  it("fades only overflowing tab edges and tolerates subpixel scrolling and elastic overscroll", () => {
    expect(terminalTabScrollEdges(0, 300, 250)).toEqual({
      left: false,
      right: false,
    });
    expect(terminalTabScrollEdges(0, 300, 600)).toEqual({
      left: false,
      right: true,
    });
    expect(terminalTabScrollEdges(150, 300, 600)).toEqual({
      left: true,
      right: true,
    });
    expect(terminalTabScrollEdges(300, 300, 600)).toEqual({
      left: true,
      right: false,
    });
    expect(terminalTabScrollEdges(-12, 300, 600)).toEqual({
      left: false,
      right: true,
    });
    expect(terminalTabScrollEdges(320, 300, 600)).toEqual({
      left: true,
      right: false,
    });
    expect(terminalTabScrollEdges(0.5, 300, 300.5)).toEqual({
      left: false,
      right: false,
    });
    expect(terminalTabScrollEdges(299.5, 300, 600)).toEqual({
      left: true,
      right: false,
    });
    expect(terminalTabScrollEdges(0, 600, 600)).toEqual({
      left: false,
      right: false,
    });
  });
  it("does not count the titlebar's transparent bottom padding twice", () => {
    const headerBottom = workspaceChromeBottom(42, 4, [38, 38, 38]);
    expect(headerBottom).toBe(38);
    expect(workspaceChromeBottom(42, 4, [])).toBe(38);
    const rect = workspaceBounds("right", 400, false, {
      width: 1180,
      height: 780,
      headerBottom,
      gap: 4,
    });
    expect(rect.top).toBe(42);
    expect(rect.top - 38).toBe(4);
    expect(1180 - rect.left - rect.width).toBe(4);
    // Taller platform controls still define the safe boundary.
    expect(workspaceChromeBottom(42, 4, [44, 38])).toBe(44);
  });
  it("uses the same gap at window edges and below titlebar capsules for every expanded dock", () => {
    const viewport = { width: 760, height: 520, headerBottom: 42 };
    for (const gap of [4, 6]) {
      for (const dock of ["bottom", "left", "right"] as const) {
        const rect = workspaceBounds(dock, 320, true, { ...viewport, gap });
        expect(rect.left).toBe(gap);
        expect(rect.top - viewport.headerBottom).toBe(gap);
        expect(viewport.width - rect.left - rect.width).toBe(gap);
        expect(viewport.height - rect.top - rect.height).toBe(gap);
      }
    }
    expect(workspaceSizeLimit("bottom", viewport)).toBe(470);
  });

  it("provides numeric restore dimensions for animation without losing the selected dock's anchor", () => {
    const viewport = { width: 1180, height: 780, headerBottom: 42 };
    expect(workspaceBounds("bottom", 320, false, viewport)).toEqual({
      left: 4,
      top: 456,
      width: 1172,
      height: 320,
    });
    expect(workspaceBounds("left", 400, false, viewport)).toEqual({
      left: 4,
      top: 46,
      width: 400,
      height: 730,
    });
    expect(workspaceBounds("right", 400, false, viewport)).toEqual({
      left: 776,
      top: 46,
      width: 400,
      height: 730,
    });
    expect(
      workspaceBounds("right", 900, false, { ...viewport, width: 760 }),
    ).toEqual({ left: 4, top: 46, width: 752, height: 730 });
  });

  it("grows each dock toward the content area and shrinks it toward its anchor", () => {
    expect(resizeWorkspace("bottom", 320, -80, 700)).toBe(400);
    expect(resizeWorkspace("left", 400, 80, 900)).toBe(480);
    expect(resizeWorkspace("right", 400, -80, 900)).toBe(480);
    expect(resizeWorkspace("right", 400, 80, 900)).toBe(320);
    expect(resizeWorkspace("left", 400, -80, 900)).toBe(320);
  });

  it("keeps pointer and keyboard resizing within viewport bounds, including a smaller viewport", () => {
    expect(resizeWorkspace("bottom", 320, -1000, 454)).toBe(454);
    expect(resizeWorkspace("left", 400, -1000, 744)).toBe(280);
    expect(resizeWorkspace("right", 400, -1000, 744)).toBe(744);
    expect(clampWorkspaceSize("left", 400, 240)).toBe(240);
    for (const dock of ["bottom", "left", "right"] as const) {
      expect(workspaceKeyboardSize(dock, "End", 400, 744)).toBe(744);
      expect(workspaceKeyboardSize(dock, "Home", 400, 744)).toBe(
        dock === "bottom" ? 200 : 280,
      );
    }
    expect(workspaceKeyboardSize("left", "ArrowRight", 740, 744)).toBe(744);
  });

  it("uses the physical arrow direction and ignores keys for the other axis", () => {
    expect(workspaceKeyboardSize("bottom", "ArrowUp", 320, 454)).toBe(340);
    expect(
      workspaceKeyboardSize("bottom", "ArrowLeft", 320, 454),
    ).toBeUndefined();
    expect(workspaceKeyboardSize("left", "ArrowRight", 400, 744)).toBe(420);
    expect(workspaceKeyboardSize("right", "ArrowRight", 400, 744)).toBe(380);
    expect(workspaceKeyboardSize("right", "ArrowUp", 400, 744)).toBeUndefined();
  });

  it("restores independent dock sizes without accepting malformed preferences", () => {
    expect(
      parseWorkspaceLayout(
        JSON.stringify({
          dock: "right",
          sizes: { bottom: 320, left: 360, right: 520 },
        }),
      ),
    ).toEqual({ dock: "right", sizes: { bottom: 320, left: 360, right: 520 } });
    expect(
      parseWorkspaceLayout(
        JSON.stringify({
          dock: "top",
          sizes: { bottom: -1, left: "500", right: 1e100 },
        }),
      ),
    ).toEqual(parseWorkspaceLayout(null));
    for (const raw of ["{", "null", "[]", "false", '"left"'])
      expect(parseWorkspaceLayout(raw)).toEqual(parseWorkspaceLayout(null));
  });
});
