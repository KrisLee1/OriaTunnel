import "@/i18n";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyRule } from "./rule-model";
import {
  OpenServiceButton,
  ServiceProtocolPicker,
  serviceUnavailableReason,
} from "./service-protocol";
import type { Runtime } from "@/types";

const runtime = { status: "listening", configurationChanged: false } as Runtime;
describe("service selection and launch affordance", () => {
  it("defaults to no selection and renders three actual toggle buttons", () => {
    expect(emptyRule().serviceProtocol).toBeNull();
    const html = renderToStaticMarkup(
      <ServiceProtocolPicker
        value={null}
        disabled={false}
        onChange={() => {}}
      />,
    );
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(3);
    expect(html).not.toContain('aria-pressed="true"');
    const selected = renderToStaticMarkup(
      <ServiceProtocolPicker
        value="vnc"
        disabled={false}
        onChange={() => {}}
      />,
    );
    expect(selected.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(selected).toContain('type="button"');
  });
  it("gates launch on a fixed endpoint and authoritative listening state", () => {
    const rule = { ...emptyRule(), serviceProtocol: "http" as const };
    expect(serviceUnavailableReason(rule, runtime)).toBeNull();
    expect(serviceUnavailableReason(rule)).toBe("serviceStartFirst");
    expect(
      serviceUnavailableReason(rule, { ...runtime, status: "connecting" }),
    ).toBe("serviceStartFirst");
    expect(
      serviceUnavailableReason(rule, {
        ...runtime,
        configurationChanged: true,
      }),
    ).toBe("serviceReconnect");
    expect(serviceUnavailableReason({ ...rule, kind: "D" }, runtime)).toBe(
      "serviceDynamic",
    );
    expect(serviceUnavailableReason({ ...rule, kind: "R" }, runtime)).toBe(
      "serviceRemoteLoopback",
    );
    expect(
      serviceUnavailableReason(
        { ...rule, kind: "R", bindAddress: "0.0.0.0" },
        runtime,
      ),
    ).toBeNull();
    expect(
      serviceUnavailableReason({ ...rule, serviceProtocol: null }, runtime),
    ).toBe("serviceSelectProtocol");
  });
  it("omits unconfigured actions and disables configured actions until ready or outside desktop", () => {
    const rule = { ...emptyRule(), name: "Web fixture" };
    const render = (desktop: boolean, state?: Runtime) =>
      renderToStaticMarkup(
        <OpenServiceButton
          rule={rule}
          desktop={desktop}
          runtime={state}
          onOpen={() => {}}
        />,
      );
    expect(render(true)).toBe("");
    rule.serviceProtocol = "https";
    expect(render(true)).toContain("disabled");
    expect(render(false, runtime)).toContain("disabled");
    expect(render(true, runtime)).not.toContain('disabled=""');
    expect(render(true, runtime)).toContain("Web fixture");
  });
});
