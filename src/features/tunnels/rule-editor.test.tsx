import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "@/i18n";
import "@/tunnel-i18n";
import { RuleEditor } from "./rule-editor";
import { emptyRule, emptyHost, networkChanged, rulePath } from "./rule-model";
import type { Rule } from "@/types";

function render(draft: Rule, hasHost = false) {
  return renderToStaticMarkup(
    <RuleEditor
      draft={draft}
      hosts={hasHost ? [{ ...emptyHost(), id: "h", name: "fixture" }] : []}
      busy={false}
      reconnect={false}
      onChange={() => {}}
      onAddHost={() => {}}
      onManageHosts={() => {}}
      onSave={() => {}}
      onCancel={() => {}}
    />,
  );
}
describe("forward composition and semantics", () => {
  const text = (key: string) => i18n.t(key, { ns: "tunnel" });
  it("keeps a forward editor when no host exists and provides separate host actions", () => {
    const html = render(emptyRule());
    expect(html).toContain(text("forwardType"));
    expect(html).toContain(text("selectHostSearch"));
    expect(html).toContain('role="combobox"');
    expect(html).toContain(text("addHost"));
    expect(html).toContain(text("manageHosts"));
    expect(html.indexOf(text("forwardType"))).toBeGreaterThan(
      html.indexOf(text("manageHosts")),
    );
    expect(html).not.toContain(text("user"));
    expect(html).not.toContain(text("identity"));
    expect(html).toContain("disabled");
  });
  it("keeps host actions adjacent to the host selector and service management with services", () => {
    const html = renderToStaticMarkup(
      <RuleEditor
        draft={emptyRule()}
        hosts={[]}
        busy={false}
        reconnect={false}
        onChange={() => {}}
        onAddHost={() => {}}
        onManageHosts={() => {}}
        onManageServices={() => {}}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html.indexOf(text("addHost"))).toBeLessThan(
      html.indexOf(text("selectHostSearch")),
    );
    expect(html.indexOf(text("manageHosts"))).toBeLessThan(
      html.indexOf(i18n.t("manageServices", { ns: "commands" })),
    );
    expect(html).toContain("field-heading-actions");
  });
  it("renders R endpoints on the correct machine and D without fixed target controls", () => {
    const r = render({ ...emptyRule("h"), kind: "R" }, true);
    expect(r).toContain(text("remoteBindAddress"));
    expect(r).toContain(text("localTargetHost"));
    expect(r).toContain(text("dnsR"));
    const d = render({ ...emptyRule("h"), kind: "D" }, true);
    expect(d).toContain(text("socksHint"));
    expect(d).not.toContain(text("targetPort"));
    expect(d).not.toContain(text("targetHost"));
    expect(d).toContain(text("dnsD"));
  });
  it("defaults to no remote command and supports host inheritance or explicit keepalive", () => {
    const html = render(emptyRule("h"), true);
    expect(html).toContain(text("noRemoteCommand"));
    expect(html).toContain(text("overrideConnection"));
    expect(html).not.toContain("（connection）");
    expect(html).not.toContain("（reconnect.enabled）");
    expect(html).not.toContain(`<span>${text("remoteCommand")}</span>`);
    const configured = render(
      {
        ...emptyRule("h"),
        noRemoteCommand: false,
        remoteCommand: "explicit-fixture",
        connection: {
          connectTimeoutSecs: 20,
          keepaliveIntervalSecs: 0,
          keepaliveMax: 5,
        },
      },
      true,
    );
    expect(configured).toContain("explicit-fixture");
    expect(configured).toContain(text("keepaliveIntervalTitle"));
    expect(configured).toContain("（-o ServerAliveInterval）");
    expect(configured).toContain("（-o RemoteCommand）");
  });
  it("preserves IPv6 path meaning and distinguishes metadata edits from reconnecting", () => {
    const rule = {
      ...emptyRule("h"),
      kind: "R" as const,
      bindAddress: "::1",
      targetHost: "::1",
    };
    expect(rulePath(rule, "ssh", "local")).toContain(
      "ssh [::1]:15432 → local [::1]:5432",
    );
    expect(rulePath({ ...rule, kind: "L" }, "ssh", "local")).toBe(
      "local [::1]:15432 → ssh [::1]:5432",
    );
    expect(rulePath({ ...rule, kind: "D" }, "ssh", "local")).toBe(
      "local SOCKS5 [::1]:15432 → ssh (DNS / TCP)",
    );
    expect(networkChanged(rule, { ...rule, name: "renamed" })).toBe(false);
    expect(networkChanged(rule, { ...rule, autoConnect: true })).toBe(false);
    expect(networkChanged(rule, { ...rule, color: "#7c3aed" })).toBe(false);
    expect(
      networkChanged(rule, { ...rule, icon: { kind: "emoji", value: "🚀" } }),
    ).toBe(false);
    expect(networkChanged(rule, { ...rule, serviceProtocol: "vnc" })).toBe(
      false,
    );
    expect(networkChanged(rule, { ...rule, targetPort: 8080 })).toBe(true);
  });
});
