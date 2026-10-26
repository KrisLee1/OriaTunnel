import "@/i18n";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { emptyRule } from "./rule-model";
import {
  OpenProxyBrowserButton,
  ProxyServiceButtons,
  proxyBrowserUnavailableReason,
  proxyBrowserChoices,
} from "./proxy-browser";
import type { Runtime } from "@/types";
import { newService } from "@/features/commands/command-model";
import { ServiceRunningContext } from "@/features/commands/service-running-context";

describe("proxy browser launch", () => {
  it("shares remote lifecycle color while gating browser launch on the separate D listener", () => {
    const service = {
      ...newService("host"),
      id: "service",
      name: "Remote service",
      port: 3689,
      color: "#7c3aed",
      icon: { kind: "builtin" as const, value: "server" },
    };
    const rule = { ...emptyRule("host"), id: "d", kind: "D" as const };
    const render = (running: boolean, status: string) =>
      renderToStaticMarkup(
        <ServiceRunningContext.Provider value={() => running}>
          <OpenProxyBrowserButton
            rule={rule}
            service={service}
            desktop
            runtime={{ status, configurationChanged: false } as Runtime}
            onOpen={() => {}}
          />
        </ServiceRunningContext.Provider>,
      );
    const stoppedService = render(false, "listening");
    expect(stoppedService).toContain("grayscale(1)");
    expect(stoppedService).not.toContain('disabled=""');
    const stoppedForward = render(true, "stopped");
    expect(stoppedForward).toContain("#7c3aed");
    expect(stoppedForward).not.toContain("grayscale(1)");
    expect(stoppedForward).toContain('disabled=""');
  });
  it("offers the shared scroll and expand strip for associated D services without lifecycle controls", () => {
    const rule = { ...emptyRule("host"), id: "d", kind: "D" as const };
    const services = Array.from({ length: 18 }, (_, i) => ({
      ...newService("host"),
      id: `s${i}`,
      name: `Service ${i}`,
      port: 3689,
      ruleIds: ["d"],
    }));
    const html = renderToStaticMarkup(
      <ProxyServiceButtons
        rule={rule}
        services={[
          ...services,
          {
            ...services[0],
            id: "foreign",
            name: "Foreign service",
            hostIds: ["other"],
          },
        ]}
        desktop
        onOpen={() => {}}
        expandable
      />,
    );
    expect(html).toContain("service-icon-strip");
    expect(html).toContain("proxy-service-strip");
    expect(html).toContain('aria-expanded="false"');
    expect(html.match(/aria-haspopup="menu"/g)).toHaveLength(18);
    expect(html).not.toContain("Foreign service");
    expect(html).not.toMatch(/aria-label="(?:启动|停止|Start|Stop)/);
    const compact = renderToStaticMarkup(
      <ProxyServiceButtons
        rule={rule}
        services={services}
        desktop
        onOpen={() => {}}
        expandable={false}
      />,
    );
    expect(compact).toContain("service-icon-strip");
    expect(compact).not.toContain("aria-controls=");
  });
  it("offers all supported browsers with locally packaged color icons", () => {
    expect(proxyBrowserChoices.map(({ id }) => id)).toEqual([
      "edge",
      "chrome",
      "firefox",
    ]);
    for (const choice of proxyBrowserChoices) {
      expect(choice.name).toBeTruthy();
      expect(choice.icon).not.toMatch(/^https?:/);
    }
    for (const file of [
      "microsoftedge.svg",
      "googlechrome.svg",
      "firefoxbrowser.svg",
    ]) {
      const svg = readFileSync(`src/assets/${file}`, "utf8");
      expect(svg).toContain("<svg");
      expect(new Set(svg.match(/#[0-9a-f]{6}\b/gi)).size).toBeGreaterThan(1);
      expect(svg).not.toMatch(
        /<script|<foreignObject|\bonload\s*=|(?:href|src)=["']https?:/i,
      );
    }
  });
  const rule = {
    ...emptyRule(),
    id: "fixture",
    name: "SOCKS fixture",
    kind: "D" as const,
  };
  const runtime = {
    status: "listening",
    configurationChanged: false,
  } as Runtime;
  it("offers only dynamic forwards and gates on real listening state", () => {
    expect(proxyBrowserUnavailableReason(rule, runtime)).toBeNull();
    expect(proxyBrowserUnavailableReason(rule)).toBe("serviceStartFirst");
    for (const status of ["stopped", "connecting", "failed", "reconnecting"])
      expect(proxyBrowserUnavailableReason(rule, { ...runtime, status })).toBe(
        "serviceStartFirst",
      );
    expect(
      proxyBrowserUnavailableReason(rule, {
        ...runtime,
        configurationChanged: true,
      }),
    ).toBe("serviceReconnect");
    const render = (kind: "L" | "R" | "D", desktop: boolean, state?: Runtime) =>
      renderToStaticMarkup(
        <OpenProxyBrowserButton
          rule={{ ...rule, kind }}
          runtime={state}
          desktop={desktop}
          onOpen={() => {}}
        />,
      );
    expect(render("L", true, runtime)).toBe("");
    expect(render("R", true, runtime)).toBe("");
    expect(render("D", true)).toContain("disabled");
    expect(render("D", false, runtime)).toContain("disabled");
    expect(render("D", true, runtime)).not.toContain('disabled=""');
    expect(render("D", true, runtime)).toContain("SOCKS fixture");
    expect(render("D", true, runtime)).toContain('aria-haspopup="menu"');
  });
});
