import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "@/i18n";
import "@/tunnel-i18n";
import {
  mergeRuns,
  OutputDecoder,
  changeActionKind,
  newAction,
  newService,
  copyService,
} from "./command-model";
import { ServiceEditor } from "./preset-commands";
import type { CommandRun, Snapshot, RemoteService } from "@/types";
import { emptyHost, emptyRule } from "@/features/tunnels/rule-model";
const run = {
  id: "run",
  revision: 2,
  startedAt: 1,
  finishedAt: null,
} as CommandRun;
describe("command output and configuration", () => {
  it("creates an independent service draft with fresh action references and preserves disabled permission", () => {
    const start = {
      ...newAction("start", "Start"),
      command: "PORT='8000' 'worker'",
      invocation: {
        executable: "worker",
        arguments: [],
        environment: [{ name: "PORT", value: "8000" }],
      },
    };
    const status = { ...newAction("status", "Status"), command: "check" };
    const source: RemoteService = {
      ...newService(""),
      id: "original",
      revision: "revision",
      name: "Worker",
      category: "inference",
      ruleIds: ["rule"],
      executionEnabled: false,
      color: "#123456",
      icon: { kind: "builtin", value: "brain" },
      actions: [start, status],
      control: {
        statusProbe: {
          actionId: status.id,
          mode: "output",
          runningCodes: [0],
          stoppedCodes: [3],
          failedCodes: [],
        },
        startActionId: start.id,
        healthProbe: null,
        ttlSecs: 60,
        checkAfterActions: false,
      },
    };
    const copy = copyService(source);
    expect(copy).toMatchObject({
      id: "",
      revision: "",
      executionHostId: "",
      ruleIds: [],
      category: "inference",
      executionEnabled: false,
      name: "Worker",
      color: "#123456",
      icon: source.icon,
    });
    expect(copy.actions[0].id).not.toBe(start.id);
    expect(copy.actions[1].id).not.toBe(status.id);
    expect(copy.control?.startActionId).toBe(copy.actions[0].id);
    expect(copy.control?.statusProbe?.actionId).toBe(copy.actions[1].id);
    copy.actions[0].invocation!.environment![0].value = "9000";
    expect(source.actions[0].invocation!.environment![0].value).toBe("8000");
    expect(source.ruleIds).toEqual(["rule"]);
  });
  it("updates default action titles with the selected kind while preserving custom names and scripts", () => {
    const labels = {
      start: "启动",
      stop: "停止",
      restart: "重启",
      status: "状态",
      logs: "日志",
      custom: "自定义",
    };
    const action = {
      ...newAction("start", labels.start),
      command: "custom script",
    };
    const stop = changeActionKind(action, "stop", labels);
    expect(stop).toMatchObject({
      kind: "stop",
      label: "停止",
      confirm: true,
      command: "custom script",
      id: action.id,
    });
    expect(changeActionKind(stop, "status", labels)).toMatchObject({
      kind: "status",
      label: "状态",
      confirm: false,
    });
    expect(
      changeActionKind({ ...action, kind: "stop" }, "status", labels).label,
    ).toBe("状态");
    expect(
      changeActionKind({ ...action, label: "My worker" }, "stop", labels).label,
    ).toBe("My worker");
  });
  it("incrementally decodes split UTF-8 and keeps streams separate without interpreting escapes", () => {
    const d = new OutputDecoder();
    const bytes = [...new TextEncoder().encode("中文")];
    const event = {
      run,
      reset: false,
      output: [
        { sequence: 1, stream: "stdout" as const, bytes: bytes.slice(0, 2) },
      ],
    };
    expect(d.accept(event)).toBe("");
    expect(
      d.accept({
        ...event,
        output: [
          {
            sequence: 2,
            stream: "stderr",
            bytes: [...new TextEncoder().encode("error")],
          },
          { sequence: 3, stream: "stdout", bytes: bytes.slice(2) },
        ],
      }),
    ).toBe("error中文");
    expect(
      d.accept({
        ...event,
        output: [{ sequence: 4, stream: "stdout", bytes: [27, 93, 53, 50, 7] }],
      }),
    ).toContain("␛]52␇");
    expect(d.accept(event)).not.toBe("");
    expect(
      d.accept({
        ...event,
        reset: true,
        output: [{ sequence: 10, stream: "stdout", bytes: [65] }],
      }),
    ).toBe("A");
  });
  it("does not let an older list snapshot revive a completed command", () => {
    const done = { ...run, revision: 9, finishedAt: 50, phase: "succeeded" };
    expect(mergeRuns([done], [run])).toEqual([done]);
  });
  it("renders linked forwards, user-defined scripts, confirmations and labels in eight languages", async () => {
    const host = {
      ...emptyHost(),
      id: "host",
      name: "isolated",
      address: "127.0.0.1",
      user: "tester",
    };
    const service: RemoteService = {
      id: "",
      name: "Model",
      executionHostId: "host",
      ruleIds: ["rule"],
      revision: "",
      noLocalEnvironment: true,
      actions: [
        {
          id: "action",
          kind: "restart",
          label: "Restart worker",
          command: "<script>CANARY</script>",
          timeoutSecs: 60,
          successCodes: [0, 3],
          confirm: true,
        },
      ],
    };
    const data = {
      hosts: [host],
      rules: [{ ...emptyRule("host"), id: "rule", name: "API" }],
    } as Snapshot;
    for (const lang of ["zh-CN", "zh-TW", "en", "ja", "ko", "de", "fr", "ru"]) {
      await i18n.changeLanguage(lang);
      const html = renderToStaticMarkup(
        <ServiceEditor
          service={service}
          data={data}
          busy={false}
          onSave={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(html).toContain("&lt;script&gt;CANARY&lt;/script&gt;");
      expect(html).not.toContain("<script>");
      expect(html).toContain('type="checkbox"');
      expect(html).toContain("aria-describedby=");
      expect(html).toContain("for=");
      expect(html).not.toContain("kindLabel");
      const base = Object.keys(i18n.getResourceBundle("en", "commands"));
      expect(Object.keys(i18n.getResourceBundle(lang, "commands"))).toEqual(
        base,
      );
    }
    await i18n.changeLanguage("zh-CN");
  });
});
