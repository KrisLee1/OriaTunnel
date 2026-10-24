import { describe, it, expect, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "@/i18n";
import {
  ControlEditor,
  ServiceState,
  CredentialRetry,
  ServiceOperations,
  defaultControl,
  parseCodes,
} from "./service-controls";
import type {
  CommandRun,
  RemoteService,
  Snapshot,
  ServiceObservation,
} from "@/types";
import { emptyHost, emptyRule } from "@/features/tunnels/rule-model";
const host = {
  ...emptyHost(),
  id: "host",
  name: "isolated",
  address: "127.0.0.1",
  user: "tester",
};
const control = {
  ...defaultControl(),
  startActionId: "start",
  statusProbe: {
    actionId: "status",
    mode: "exitCode" as const,
    runningCodes: [0],
    stoppedCodes: [3],
    failedCodes: [],
  },
  healthProbe: {
    command: "<script>HEALTH_CANARY</script>",
    readyCodes: [0],
    notReadyCodes: [1],
    repeatable: false,
    timeoutSecs: 5,
    intervalSecs: 2,
    budgetSecs: 60,
  },
};
const service: RemoteService = {
  id: "service",
  name: "Model",
  executionHostId: "host",
  revision: "v1",
  noLocalEnvironment: true,
  ruleIds: ["linked"],
  control,
  actions: [
    {
      id: "status",
      kind: "status",
      label: "Status",
      command: "check",
      timeoutSecs: 5,
      successCodes: [0],
      confirm: false,
    },
    {
      id: "start",
      kind: "start",
      label: "Start",
      command: "start",
      timeoutSecs: 60,
      successCodes: [0],
      confirm: true,
    },
  ],
};
const data = {
  hosts: [host],
  services: [service],
  rules: [
    { ...emptyRule("host"), id: "linked", name: "Linked forward" },
    { ...emptyRule("host"), id: "unrelated", name: "Unrelated forward" },
  ],
} as Snapshot;
describe("service control UI", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
  });
  it("renders explicit probe settings and bounded wait fields with escaped scripts in all languages", async () => {
    const flatten = (value: Record<string, unknown>, prefix = ""): string[] =>
      Object.entries(value).flatMap(([key, v]) =>
        v && typeof v === "object"
          ? flatten(v as Record<string, unknown>, `${prefix}${key}.`)
          : [`${prefix}${key}`],
      );
    const expected = flatten(i18n.getResourceBundle("en", "commands"));
    for (const lang of ["zh-CN", "zh-TW", "en", "ja", "ko", "de", "fr", "ru"]) {
      await i18n.changeLanguage(lang);
      const html = renderToStaticMarkup(
        <ControlEditor service={service} onChange={() => {}} />,
      );
      expect(html).toContain("&lt;script&gt;HEALTH_CANARY&lt;/script&gt;");
      expect(html).not.toContain("<script>");
      expect(html).toContain('max="600"');
      expect(html).toContain('role="switch"');
      expect(html).not.toMatch(/>service\.[a-zA-Z]/);
      expect(flatten(i18n.getResourceBundle(lang, "commands"))).toEqual(
        expected,
      );
    }
    await i18n.changeLanguage("zh-CN");
  });
  it("shows backend expiry and observation time without inferring readiness from process state", () => {
    const obs = {
      status: {
        value: "running",
        checkedAt: 1,
        validUntil: 2,
        sourceRunId: "run",
        expired: true,
      },
      health: { value: "unverified", checkedAt: null, expired: false },
    } as ServiceObservation;
    const html = renderToStaticMarkup(<ServiceState observation={obs} />);
    expect(html).toContain("运行中");
    expect(html).toContain("已过期");
    expect(html).toContain("未验证");
    expect(html).not.toContain("aria-live");
  });
  it("only offers linked forwards and never offers a whole-operation retry after any exec submission", () => {
    const html = renderToStaticMarkup(
      <ServiceOperations
        service={service}
        data={data}
        disabled={false}
        onOperation={() => {}}
      />,
    );
    expect(html).toContain("Linked forward");
    expect(html).not.toContain("Unrelated forward");
    const run = {
      serviceId: "service",
      serviceRevision: "v1",
      error: "authentication",
      submitted: true,
      actionId: "$connect:linked",
    } as CommandRun;
    expect(
      renderToStaticMarkup(
        <CredentialRetry
          data={data}
          run={run}
          onRun={() => {}}
          onError={() => {}}
        />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <CredentialRetry
          data={data}
          run={{ ...run, submitted: false, error: "remoteUnknown" }}
          onRun={() => {}}
          onError={() => {}}
        />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <CredentialRetry
          data={data}
          run={{ ...run, submitted: false }}
          onRun={() => {}}
          onError={() => {}}
        />,
      ),
    ).toContain("补充凭据后重试");
    expect(
      renderToStaticMarkup(
        <CredentialRetry
          data={{
            ...data,
            services: [{ ...service, executionEnabled: false }],
          }}
          run={{ ...run, submitted: false }}
          onRun={() => {}}
          onError={() => {}}
        />,
      ),
    ).toBe("");
  });
  it("keeps empty optional code lists distinct from invalid or ambiguous input", () => {
    expect(parseCodes("")).toEqual([]);
    expect(parseCodes("0, 3")).toEqual([0, 3]);
    expect(parseCodes("0,")[1]).toBeNaN();
    expect(parseCodes("error")[0]).toBeNaN();
  });
});
