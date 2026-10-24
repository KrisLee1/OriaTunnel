import { describe, expect, it } from "vitest";
import { emptyHost } from "@/features/tunnels/rule-model";
import { automaticAuthOutcome, hostAuthMethod, needsInitialSecret } from "./host-auth";
import type { Runtime } from "@/types";
import i18n from "@/i18n";
import "@/tunnel-i18n";

describe("authentication flow", () => {
  const host = { ...emptyHost(), identityFiles: ["/fixture/key"] };
  const runtime = (status: string, errorKind?: string, runId = "new") =>
    ({ status, errorKind, runId }) as Runtime;
  it("provides fallback credential guidance in all eight supported languages", () => {
    for (const language of ["zh-CN", "zh-TW", "en", "ja", "ko", "de", "fr", "ru"])
      for (const key of ["authFallbackHelp", "privateKeyPassphrase"])
        expect(i18n.getResource(language, "tunnel", key)).toBeTypeOf("string");
  });
  it("labels configured keys and agents without changing Auto's fallback policy", () => {
    expect(hostAuthMethod(host)).toBe("privateKey");
    expect(host.authMethod).toBe("auto");
    expect(hostAuthMethod({ ...emptyHost(), identityAgent: "/fixture/agent" })).toBe("agent");
    expect(hostAuthMethod({ ...emptyHost(), identityAgent: "none", identityFiles: ["none"] })).toBe("auto");
    expect(hostAuthMethod({ ...host, authMethod: "password" })).toBe("password");
    expect(hostAuthMethod(host, { authMethodUsed: "agent" } as Runtime)).toBe("agent");
  });
  it("only prompts for explicit password routes before making a connection", () => {
    expect(needsInitialSecret([host, { ...emptyHost(), authMethod: "agent" }])).toBe(false);
    expect(needsInitialSecret([{ ...host, authMethod: "privateKey" }])).toBe(false);
    expect(needsInitialSecret([host, { ...emptyHost(), authMethod: "password" }])).toBe(true);
  });
  it("only requests fallback credentials for a new Rust authentication failure", () => {
    const attempt = { previousRunId: "old" };
    expect(automaticAuthOutcome(attempt)).toBe("waiting");
    expect(automaticAuthOutcome(attempt, runtime("failed", "authentication", "old"))).toBe("waiting");
    expect(automaticAuthOutcome(attempt, runtime("verifying-host"))).toBe("waiting");
    expect(automaticAuthOutcome(attempt, runtime("authenticating"))).toBe("waiting");
    expect(automaticAuthOutcome(attempt, runtime("failed", "authentication"))).toBe("prompt");
    expect(automaticAuthOutcome(attempt, runtime("needs-attention", "authentication"))).toBe("prompt");
    for (const kind of ["host-key", "network", "timeout", "configuration"])
      expect(automaticAuthOutcome(attempt, runtime("failed", kind))).toBe("done");
    for (const status of ["tested", "listening", "stopped"])
      expect(automaticAuthOutcome(attempt, runtime(status))).toBe("done");
  });
});
