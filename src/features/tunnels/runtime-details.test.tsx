import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "@/i18n";
import { RuntimeDetails } from "./runtime-details";
import { bytes, duration, rate } from "./runtime-format";
import { emptyRule } from "./rule-model";
import type { Runtime } from "@/types";
const text = (key: string) => i18n.t(key, { ns: "tunnel" });
describe("runtime unit conversion", () => {
  it("scales totals and rates across unit boundaries without rounding sub-byte rates to zero", () => {
    expect(bytes(0)).toBe("0 B");
    expect(bytes(1023)).toBe("1023 B");
    expect(bytes(1024)).toBe("1.0 KiB");
    expect(bytes(1024 ** 2 - 1)).toBe("1.0 MiB");
    expect(bytes(1024 ** 4)).toBe("1.0 TiB");
    expect(rate(0.5)).toBe("0.5 B/s");
    expect(rate(1024 ** 2)).toBe("1.0 MiB/s");
    expect(rate(undefined)).toBe("—");
    expect(bytes(Number.NaN)).toBe("—");
  });
  it("converts uptime at minute, hour and day boundaries and keeps missing evidence unknown", () => {
    expect(duration()).toBe("—");
    expect(duration(0)).toBe("0s");
    expect(duration(59)).toBe("59s");
    expect(duration(60)).toBe("1m");
    expect(duration(3600)).toBe("1h");
    expect(duration(90061)).toBe("1d 1h 1m 1s");
    expect(duration(4288, ["天", "小时", "分", "秒"])).toBe("1小时 11分 28秒");
  });
});
describe("runtime evidence", () => {
  it("shows unmeasured values without inventing authentication or traffic", () => {
    const html = renderToStaticMarkup(
      <RuntimeDetails rule={emptyRule("fixture")} hostName="fixture" />,
    );
    expect(html).toContain(text("unknown"));
    expect(html).toContain(text("unmeasured"));
    expect(html).not.toContain("0 B");
    expect(html).not.toContain(text("authAuto"));
    expect(html).not.toContain("<svg");
  });
  it("keeps a target refusal distinct from listening and renders measured samples", () => {
    const runtime: Runtime = {
      ruleId: "fixture",
      runId: "run",
      status: "listening",
      message: "",
      sent: 1024,
      received: 2048,
      connections: 1,
      configurationChanged: false,
      desiredRunning: true,
      retryCount: 1,
      uptimeSecs: 10,
      authMethodUsed: "password",
      sentPerSecond: 1024,
      receivedPerSecond: 2048,
      targetHealth: {
        state: "unreachable",
        checkedAt: 1,
        side: "remote",
        method: "tcp-connect",
      },
      history: [
        { timestamp: 1, sentPerSecond: 1024, receivedPerSecond: 2048 },
        { timestamp: 2, sentPerSecond: 0, receivedPerSecond: 0 },
      ],
    };
    const html = renderToStaticMarkup(
      <RuntimeDetails
        rule={emptyRule("fixture")}
        runtime={runtime}
        hostName="fixture"
      />,
    );
    expect(html).toContain(text("listening"));
    expect(html).toContain(text("unreachable"));
    expect(html).toContain(text("authPassword"));
    expect(html).toContain(text("targetHealthHint"));
    expect(html).toContain("1.0 KiB");
    expect(html).toContain("<svg");
    const idle = renderToStaticMarkup(
      <RuntimeDetails
        rule={emptyRule("fixture")}
        hostName="fixture"
        runtime={{
          ...runtime,
          history: runtime.history!.map((sample) => ({
            ...sample,
            sentPerSecond: 0,
            receivedPerSecond: 0,
          })),
        }}
      />,
    );
    expect(idle).toContain(text("noRecentTraffic"));
    expect(idle).not.toContain(text("unmeasured"));
    expect(idle).not.toContain("<svg");
  });
});
