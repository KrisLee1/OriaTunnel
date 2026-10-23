import { describe, expect, it } from "vitest";
import { emptyRule } from "./rule-model";
import { connectionPorts, connectionVisual } from "./connection-visual";

describe("connection visual semantics", () => {
  const rule = { ...emptyRule("h"), color: "#7c3aed" };
  it("only shows a solid connected line after Rust reports a listener", () => {
    expect(connectionVisual(rule, { status: "listening" })).toEqual({
      state: "connected",
      color: rule.color,
    });
    for (const status of [
      "connecting",
      "authenticating",
      "verifying-host",
      "reconnecting",
    ]) {
      expect(connectionVisual(rule, { status })).toEqual({
        state: "connecting",
        color: rule.color,
      });
    }
    for (const status of [
      "stopped",
      "failed",
      "needs-attention",
      "stopping",
      "unknown",
    ]) {
      expect(connectionVisual(rule, { status })).toEqual({
        state: "stopped",
        color: "var(--oria-color-muted-fg)",
      });
    }
    expect(connectionVisual(rule).state).toBe("stopped");
    expect(connectionVisual(emptyRule(), { status: "listening" }).color).toBe(
      "var(--oria-color-accent)",
    );
  });
  it("labels L, reversed R and dynamic D endpoints without inventing a SOCKS destination port", () => {
    expect(connectionPorts(rule)).toEqual({ local: "15432", host: "5432" });
    expect(connectionPorts({ ...rule, kind: "R" })).toEqual({
      local: "5432",
      host: "15432",
    });
    expect(connectionPorts({ ...rule, kind: "D" }, 2222)).toEqual({
      local: "15432",
      host: "SSH 2222",
    });
  });
});
