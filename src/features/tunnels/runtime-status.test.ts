import { describe, expect, it } from "vitest";
import { runtimeStatus } from "./runtime-status";

describe("runtime status presentation", () => {
  it("uses Rust error categories to explain failures instead of a generic attention badge", () => {
    const labels = {
      authentication: "status-authentication-error",
      "host-key": "status-host-key-error",
      network: "status-network-error",
      dns: "status-dns-error",
      timeout: "status-timeout",
      bind: "status-bind-error",
      "forward-denied": "status-forward-error",
      configuration: "status-configuration-error",
      "remote-command": "status-command-error",
    };
    for (const [errorKind, label] of Object.entries(labels)) {
      const result = runtimeStatus({
        status: "needs-attention",
        errorKind,
        configurationChanged: false,
      });
      expect(result.label).toBe(label);
      expect(result.tone).toBe(
        ["authentication", "host-key"].includes(errorKind)
          ? "warning"
          : "danger",
      );
    }
    expect(
      runtimeStatus({
        status: "failed",
        errorKind: "authentication",
        configurationChanged: false,
      }).label,
    ).toBe("status-authentication-error");
    expect(
      runtimeStatus({ status: "failed", configurationChanged: false }).label,
    ).toBe("status-connection-error");
  });
  it("does not replace authoritative running or retry states with stale failure metadata", () => {
    expect(runtimeStatus().label).toBe("stopped");
    for (const status of [
      "listening",
      "tested",
      "connecting",
      "authenticating",
      "verifying-host",
      "reconnecting",
      "stopped",
    ])
      expect(
        runtimeStatus({
          status,
          errorKind: "authentication",
          configurationChanged: false,
        }).label,
      ).toBe(status);
  });
});
