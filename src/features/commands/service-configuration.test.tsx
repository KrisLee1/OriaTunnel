import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import i18n from "@/i18n";
import { posixShell } from "@/test/posix-shell";
import {
  renderInvocation,
  normalizeInvocation,
  CommandInvocationEditor,
  CommandEnvironmentEditor,
  editActionEnvironment,
  editActionScript,
  actionScript,
  isStructuredCommand,
  switchActionFormat,
} from "./command-invocation";
import {
  builtinServiceTemplates,
  applyLaunchTemplate,
  fillServiceTemplate,
  groupServiceTemplates,
  serviceTemplateCategories,
  serviceTemplateGroups,
  localizedServiceTemplates,
  groupServices,
  serviceCategory,
  type ServiceTemplateGroup,
} from "./service-template-catalog";
import {
  ServiceEditor,
  ServicesPage,
  PresetCommandProvider,
  HostServices,
} from "./preset-commands";
import { RuleEditor } from "@/features/tunnels/rule-editor";
import { emptyHost, emptyRule } from "@/features/tunnels/rule-model";
import { newService } from "./command-model";
import type { RemoteService, Snapshot, ServiceTemplate } from "@/types";
import catalog from "@/features/tunnels/connection-icon-catalog.json";
import categoryIds from "./service-category-ids.json";
const host = { ...emptyHost(), id: "host", name: "fixture" };
const service: RemoteService = {
  ...newService("host"),
  id: "svc",
  name: "Model service",
  revision: "rev",
  ruleIds: ["rule"],
  color: "#67ad98",
  icon: { kind: "builtin", value: "brain" },
  actions: [
    {
      id: "start",
      kind: "start",
      label: "Launch",
      command: "printf ok",
      timeoutSecs: 60,
      confirm: true,
      successCodes: [0],
    },
  ],
};
const snapshot = {
  hosts: [host],
  rules: [{ ...emptyRule("host"), id: "rule", name: "Forward" }],
  services: [service],
  addedHostIds: ["host"],
  hostSnapshots: [],
  runtimes: [],
  diagnostics: [],
} as unknown as Snapshot;
function base(resource: string): ServiceTemplate {
  return {
    resource,
    shell: "POSIX sh",
    control: {
      statusProbe: {
        actionId: "status",
        mode: "exitCode",
        runningCodes: [0],
        stoppedCodes: [3],
        failedCodes: [4],
      },
      healthProbe: null,
      startActionId: "start",
      checkAfterActions: false,
      ttlSecs: 30,
    },
    actions: ["start", "stop", "restart", "status", "logs"].map((kind) => ({
      id: kind,
      kind: kind as "start",
      label: kind,
      command:
        kind === "status"
          ? 'load=$(systemctl --user show --property=LoadState --value -- unit) || exit 5\n[ "$load" = loaded ] || exit 5\nexit 0'
          : `printf '%s' ${kind}`,
      timeoutSecs: 60,
      successCodes: [0],
      confirm: kind === "restart" || kind === "stop",
    })),
  };
}
describe("service configuration", () => {
  it("keeps host services icon-only with scroll area, disclosure and a separate Boxes manager", () => {
    const html = renderToStaticMarkup(
      <PresetCommandProvider
        data={{
          ...snapshot,
          services: [service, { ...service, id: "second" }],
        }}
        onSnapshot={() => {}}
      >
        <HostServices hostId="host" />
      </PresetCommandProvider>,
    );
    expect(html).toContain("host-service-scroll");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("aria-controls=");
    expect(html).toContain("lucide-boxes");
    expect(html.indexOf("service-command-icons")).toBeLessThan(
      html.indexOf("host-service-tools"),
    );
    expect(html.indexOf("host-service-tools")).toBeLessThan(
      html.indexOf("lucide-boxes"),
    );
    expect(html).not.toContain('class="service-name-text"');
  });
  it("renders host groups, repeats shared definitions and isolates unassigned services", () => {
    const shared = { ...service, hostIds: ["second", "host"] };
    const html = renderToStaticMarkup(
      <PresetCommandProvider
        data={{
          ...snapshot,
          hosts: [host, { ...host, id: "second", name: "second-host" }],
          services: [
            shared,
            {
              ...service,
              id: "unbound",
              name: "unbound-service",
              hostIds: [],
              ruleIds: [],
            },
          ],
        }}
        onSnapshot={() => {}}
        page
      >
        <ServicesPage />
      </PresetCommandProvider>,
    );
    const headings = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map(
      (match) => match[1],
    );
    expect(headings.findIndex((h) => h.includes("fixture"))).toBeLessThan(
      headings.findIndex((h) => h.includes("second-host")),
    );
    expect(headings.at(-1)).toContain(
      i18n.t("unassignedHost", { ns: "commands" }),
    );
    expect(html.match(/title="Model service"/g)).toHaveLength(2);
    expect(html.match(/title="unbound-service"/g)).toHaveLength(1);
  });
  it("keeps disabled state beside the service name, uses forwarding selection placement and direct permission actions", () => {
    const disabled = { ...service, executionEnabled: false };
    const html = renderToStaticMarkup(
      <PresetCommandProvider
        data={{ ...snapshot, services: [disabled] }}
        onSnapshot={() => {}}
        page
      >
        <ServicesPage />
      </PresetCommandProvider>,
    );
    expect(html).toContain('class="rule-select service-select"');
    const heading = html.match(/<h3[^>]*>[\s\S]*?<\/h3>/)?.[0] || "";
    expect(heading).toContain("Model service");
    expect(heading).toContain(i18n.t("sharing.disabled", { ns: "commands" }));
    expect(heading.indexOf("Model service")).toBeLessThan(
      heading.indexOf(i18n.t("sharing.disabled", { ns: "commands" })),
    );
    expect(html).toContain(
      `${i18n.t("sharing.enableReview", { ns: "commands" })} Model service`,
    );
    expect(html).not.toContain("lucide-ellipsis");
    expect(html).not.toContain(i18n.t("sharing.export", { ns: "commands" }));
    expect(html).toContain(i18n.t("batch.exportAll", { ns: "commands" }));
  });
  it("groups services by service category rather than command kinds and honors explicit choices", () => {
    expect(categoryIds).toEqual([...serviceTemplateCategories]);
    const legacy = {
      ...service,
      category: undefined,
      icon: { kind: "builtin" as const, value: "ollama" },
    };
    expect(serviceCategory(legacy)).toBe("inference");
    expect(serviceCategory({ ...legacy, category: "development" })).toBe(
      "development",
    );
    expect(serviceCategory({ ...legacy, category: "other" })).toBe("other");
    const groups = groupServices([
      legacy,
      { ...legacy, id: "other", category: "other" },
    ]);
    expect(groups.map((group) => group.category)).toEqual([
      "inference",
      "other",
    ]);
    expect(groups.flatMap((group) => group.services)).toHaveLength(2);
  });
  it("applies variables to an entire shell script and preserves source and variables through format changes", () => {
    const source =
      '# keep the script\nprintf "%s\\0" "$ORIA_SCRIPT_TEST"\nprintf "%s" "${ORIA_EMPTY_TEST+x}"\n';
    const literal = "a' b $HOME $(printf UNSAFE) 中文";
    const original = {
      ...service.actions[0],
      invocation: null,
      command: source,
    };
    const scripted = editActionEnvironment(original, [
      { name: "ORIA_SCRIPT_TEST", value: literal },
      { name: "ORIA_EMPTY_TEST", value: "" },
    ]);
    expect(isStructuredCommand(scripted)).toBe(false);
    expect(actionScript(scripted)).toBe(source);
    expect(execFileSync(posixShell, ["-c", scripted.command]).toString()).toBe(
      `${literal}\0x`,
    );
    const structured = switchActionFormat(scripted, "command");
    expect(isStructuredCommand(structured)).toBe(true);
    const restored = switchActionFormat(structured, "script");
    expect(actionScript(restored)).toBe(source);
    expect(restored.invocation?.environment).toEqual(
      scripted.invocation?.environment,
    );
    expect(actionScript(JSON.parse(JSON.stringify(restored)))).toBe(source);
    const changed = editActionScript(restored, source + "# edited\n");
    const removed = editActionEnvironment(changed, []);
    expect(removed.invocation).toBeNull();
    expect(removed.command).toBe(source + "# edited\n");
  });
  it("shows the common environment editor in script and structured modes and keeps script source editable", () => {
    const original = {
      ...service.actions[0],
      invocation: null,
      command: "printf original",
    };
    const scripted = editActionEnvironment(original, [
      { name: "MODEL_PORT", value: "8000" },
    ]);
    for (const action of [
      original,
      scripted,
      switchActionFormat(scripted, "command"),
    ]) {
      const html = renderToStaticMarkup(
        <ServiceEditor
          service={{ ...service, actions: [action] }}
          data={snapshot}
          busy={false}
          onSave={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(html).toContain(
        i18n.t("builder.environmentAdd", { ns: "commands" }),
      );
      const textarea = html.match(/<textarea[^>]*>/)?.[0] || "";
      expect(/readonly/i.test(textarea)).toBe(isStructuredCommand(action));
    }
  });
  it("passes explicit environment values literally, including empty values, without changing the parent environment", () => {
    const literal = "a' b;$(printf UNSAFE)`id` $HOME 中文";
    const invocation = normalizeInvocation({
      executable: "/bin/sh",
      arguments: [
        { name: "", value: "-c" },
        {
          name: "",
          value: 'printf "%s\\0%s" "$ORIA_ENV_TEST" "${ORIA_EMPTY_TEST+x}"',
        },
      ],
      environment: [
        { name: "ORIA_ENV_TEST", value: literal },
        { name: "ORIA_EMPTY_TEST", value: "" },
        { name: "", value: "" },
      ],
    });
    expect(invocation.environment).toHaveLength(2);
    expect(
      execFileSync(posixShell, ["-c", renderInvocation(invocation)]).toString(),
    ).toBe(`${literal}\0x`);
    const html = renderToStaticMarkup(
      <CommandEnvironmentEditor
        value={invocation.environment || []}
        onChange={() => {}}
      />,
    );
    expect(html).toContain(
      i18n.t("builder.environmentAdd", { ns: "commands" }),
    );
    expect(html).toContain('pattern="[A-Za-z_][A-Za-z0-9_]*"');
  });
  it("forwards recipe environment through systemd-run setenv before the executable separator", () => {
    const dir = mkdtempSync(join(tmpdir(), "oria-env-stub-"));
    try {
      const stub = join(dir, "systemd-run");
      writeFileSync(stub, '#!/bin/sh\nprintf "%s\\0" "$@"\n');
      chmodSync(stub, 0o700);
      const preset = builtinServiceTemplates.find(
        (preset) => preset.id === "dsh-systemd",
      )!;
      const result = applyLaunchTemplate(base("oria-dsh.service"), preset, {
        ...preset.launch!,
        environment: [
          { name: "CUDA_VISIBLE_DEVICES", value: "0,1" },
          { name: "LITERAL", value: "$HOME ' 中文" },
        ],
      });
      // This executable is consumed by a POSIX shell, including Git's shell on Windows.
      const invocation = {
        ...result.actions[0].invocation!,
        executable: stub.replaceAll("\\", "/"),
      };
      const args = execFileSync(posixShell, [
        "-c",
        renderInvocation(invocation),
      ])
        .toString()
        .split("\0")
        .slice(0, -1);
      expect(args.slice(0, 2)).toEqual([
        "--setenv=CUDA_VISIBLE_DEVICES=0,1",
        "--setenv=LITERAL=$HOME ' 中文",
      ]);
      expect(args.indexOf("--setenv=CUDA_VISIBLE_DEVICES=0,1")).toBeLessThan(
        args.indexOf("--"),
      );
      expect(args[args.indexOf("--") + 1]).toBe("dsh");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("omits blank parameter values and unused rows while keeping literal nonempty values", () => {
    const invocation = {
      executable: "dsh",
      arguments: [
        { name: "", value: "web" },
        { name: "--no-open", value: "" },
        { name: "--flag", value: null },
        { name: "", value: "" },
        { name: "", value: null },
        { name: "--port", value: "0" },
        { name: "--literal", value: " $(id) " },
      ],
    };
    const result = normalizeInvocation(invocation);
    expect(result.arguments).toHaveLength(5);
    expect(renderInvocation(result)).toBe(
      "'dsh' 'web' '--no-open' '--flag' '--port' '0' '--literal' ' $(id) '",
    );
    expect(invocation.arguments).toHaveLength(7);
    const html = renderToStaticMarkup(
      <CommandInvocationEditor value={result} onChange={() => {}} />,
    );
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain("lucide-trash-2");
    const inputs = [...html.matchAll(/<input[^>]*>/g)].map((match) => match[0]);
    expect(inputs.every((input) => !/\sdisabled(?:=|\s|>)/.test(input))).toBe(
      true,
    );
  });
  it("groups every recipe once and searches names and localized categories without empty groups", () => {
    const labels = Object.fromEntries(
      serviceTemplateGroups.map((category) => [
        category,
        i18n.t(`templates.groups.${category}`, { ns: "commands" }),
      ]),
    ) as Record<ServiceTemplateGroup, string>;
    const groups = groupServiceTemplates(builtinServiceTemplates, "", labels);
    expect(
      groups
        .flatMap((group) => group.templates)
        .map((template) => template.id)
        .sort(),
    ).toEqual(builtinServiceTemplates.map((template) => template.id).sort());
    const managed = groups.find((group) => group.category === "systemd")!;
    expect(managed.templates).toHaveLength(31);
    expect(managed.name).toBe(labels.systemd);
    expect(
      managed.templates.every((template) =>
        template.manager.startsWith("systemd"),
      ),
    ).toBe(true);
    expect(
      groups
        .filter((group) => group.category !== "systemd")
        .flatMap((group) => group.templates)
        .every((template) => template.manager === "direct"),
    ).toBe(true);
    expect(
      groupServiceTemplates(builtinServiceTemplates, labels.systemd, labels),
    ).toEqual([managed]);
    expect(
      managed.templates.find((template) => template.id === "dsh-systemd")
        ?.category,
    ).toBe("inference");
    expect(
      groupServiceTemplates(builtinServiceTemplates, "  ＤＳＨ  ", labels).map(
        (group) => [
          group.category,
          group.templates.map((template) => template.id),
        ],
      ),
    ).toEqual([
      ["inference", ["dsh"]],
      ["systemd", ["dsh-systemd"]],
    ]);
    expect(
      groupServiceTemplates(
        builtinServiceTemplates,
        labels.inference,
        labels,
      ).map((group) => group.category),
    ).toEqual(["inference", "systemd"]);
    expect(
      groupServiceTemplates(
        builtinServiceTemplates,
        "docker CONTAINER",
        labels,
      )[0].templates.map((template) => template.id),
    ).toEqual(["dockerContainer"]);
    expect(
      groupServiceTemplates(builtinServiceTemplates, "no-such-service", labels),
    ).toEqual([]);
  });
  it("keeps one localized Docker container in containers and only systemd templates in generic", () => {
    const templates = localizedServiceTemplates((key) =>
      i18n.t(key, { ns: "commands" }),
    );
    const containers = templates.filter(
      (template) => template.id === "dockerContainer",
    );
    expect(containers).toHaveLength(1);
    expect(containers[0]).toMatchObject({
      category: "containers",
      name: i18n.t("templates.docker", { ns: "commands" }),
    });
    expect(
      templates
        .filter((template) => template.category === "generic")
        .map((template) => template.manager)
        .sort(),
    ).toEqual(["systemdSystem", "systemdUser"]);
  });
  it("provides direct editable commands for databases, caches, messaging, monitoring and storage", () => {
    const expected = {
      databases: ["postgresql", "mysql", "mariadb", "mongodb", "elasticsearch"],
      caches: ["redis", "valkey", "memcached"],
      messaging: ["rabbitmq", "kafka"],
      observability: ["prometheus", "grafana"],
      storage: ["minio"],
    };
    for (const [category, ids] of Object.entries(expected)) {
      const templates = builtinServiceTemplates.filter(
        (template) =>
          template.category === category && template.manager === "direct",
      );
      expect(templates.map((template) => template.id).sort()).toEqual(
        ids.sort(),
      );
      for (const template of templates) {
        const result = applyLaunchTemplate(
          base(`${template.resource}.service`),
          template,
          template.launch,
        );
        expect(result.name).toBe(template.name);
        expect(result.color).toMatch(/^#[0-9a-f]{6}$/i);
        expect(result.icon).toEqual({ kind: "builtin", value: template.icon });
        expect(result.actions.length).toBeGreaterThan(0);
        expect(result.control.statusProbe).toBeNull();
        expect(
          result.actions.map((action) => action.command).join("\n"),
        ).not.toMatch(/systemctl|systemd-run|journalctl/);
      }
    }
  });
  it("imports the entire service template into an existing draft without saving or changing its identity, references or permission", () => {
    const preset = builtinServiceTemplates.find(
      (preset) => preset.id === "dsh-systemd",
    )!;
    const template = applyLaunchTemplate(
      base("oria-dsh.service"),
      preset,
      preset.launch,
    );
    const current = {
      ...service,
      executionEnabled: false,
      noLocalEnvironment: false,
    };
    const before = JSON.stringify(current);
    const result = fillServiceTemplate(current, template);
    expect(result.name).toBe("DeepSeek Harness · systemd");
    expect(result.category).toBe("inference");
    expect(result.color).toBe(preset.color);
    expect(result.icon).toEqual({ kind: "builtin", value: preset.icon });
    expect(result.actions).toEqual(template.actions);
    expect(result.control).toEqual(template.control);
    expect(result).toMatchObject({
      id: service.id,
      revision: service.revision,
      ruleIds: service.ruleIds,
      executionEnabled: false,
      noLocalEnvironment: false,
    });
    expect(JSON.stringify(current)).toBe(before);
    // Subsequent edits must change only this draft, including nested parameters.
    result.name = "Custom service";
    result.actions[0].invocation!.arguments[0].name = "--modified";
    result.control!.statusProbe!.runningCodes.push(7);
    expect(template.actions[0].invocation!.arguments[0].name).toBe("--user");
    expect(template.control.statusProbe!.runningCodes).toEqual([0]);
  });
  it("replaces stale decoration and commands when importing a generic service template", () => {
    const template = base("custom.service");
    const result = fillServiceTemplate(service, template);
    expect(result.name).toBe("custom.service");
    expect(result.color).toBeNull();
    expect(result.icon).toBeNull();
    expect(result.actions.map((action) => action.kind)).toEqual([
      "start",
      "stop",
      "restart",
      "status",
      "logs",
    ]);
  });
  it("quotes positional values, switches, empty values, Unicode and shell metacharacters literally", () => {
    const words = [
      "a b",
      "a'quote",
      "$(printf UNSAFE)",
      "`printf UNSAFE`",
      "; touch /tmp/never",
      "",
      "中文\\path",
      "$HOME %n",
    ];
    const command = renderInvocation({
      executable: "/usr/bin/printf",
      arguments: [
        { name: "", value: "%s\\0" },
        ...words.map((value) => ({ name: "", value })),
        { name: "--flag", value: null },
      ],
    });
    expect(
      execFileSync(posixShell, ["-c", command])
        .toString()
        .split("\0")
        .slice(0, -1),
    ).toEqual([...words, "--flag"]);
  });
  it("keeps direct commands and optional managed templates independent with valid shell syntax", () => {
    const scripts: string[] = [];
    expect(new Set(builtinServiceTemplates.map((p) => p.id)).size).toBe(
      builtinServiceTemplates.length,
    );
    const direct = builtinServiceTemplates.filter(
      (p) => p.manager === "direct",
    );
    expect(direct).toHaveLength(30);
    for (const preset of builtinServiceTemplates) {
      const before = base(`${preset.resource}.service`);
      const json = JSON.stringify(before);
      const result = applyLaunchTemplate(before, preset, preset.launch);
      expect(catalog.icons.some((icon) => icon.id === result.icon?.value)).toBe(
        true,
      );
      expect(JSON.stringify(before)).toBe(json);
      for (const action of result.actions) {
        // Parse each action in its own function body in one syntax-only shell.
        // Starting hundreds of MSYS processes blocks Vitest's worker on Windows.
        scripts.push(
          `oria_template_${scripts.length}() {\n${action.command}\n}`,
        );
        if (action.invocation)
          expect(action.command).toBe(renderInvocation(action.invocation));
      }
      if (preset.manager === "direct") {
        expect(result.actions.map((a) => a.command).join("\n")).not.toMatch(
          /systemctl|systemd-run|journalctl|pkill|killall|nohup/,
        );
        expect(result.control.statusProbe).toBeNull();
        expect(result.control.healthProbe).toBeNull();
        const start = result.actions.find((a) => a.kind === "start")!;
        expect(result.control.startActionId).toBe(
          start.mode === "terminal" ? null : start.id,
        );
        if (start.mode === "terminal") expect(start.timeoutSecs).toBe(0);
        else expect(start.timeoutSecs).toBeGreaterThan(0);
        continue;
      }
      expect(result.actions.map((a) => a.kind)).toEqual([
        "start",
        "stop",
        "restart",
        "status",
        "logs",
      ]);
      expect(result.control.startActionId).toBe(result.actions[0].id);
      expect(result.control.statusProbe?.actionId).toBe(result.actions[3].id);
      if (preset.launch) {
        expect(preset.id).toMatch(/-systemd$/);
        expect(result.actions[0].invocation?.executable).toBe("systemd-run");
        expect(result.actions[0].command).toContain("'--collect'");
        expect(result.actions[0].command).not.toContain("--expand-environment");
        expect(result.actions[3].command).toContain(
          '[ "$load" != not-found ] || exit 3',
        );
        expect(result.actions[2].command).toContain(result.actions[0].command);
      }
    }
    for (const preset of direct.filter((p) => p.id !== "dockerContainer")) {
      expect(
        builtinServiceTemplates.find((p) => p.id === `${preset.id}-systemd`)
          ?.name,
      ).toBe(`${preset.name} · systemd`);
    }
    execFileSync(posixShell, ["-n"], { input: scripts.join("\n") });
  });
  it("handles a collected transient unit even when systemctl returns an error with not-found", () => {
    const dir = mkdtempSync(join(tmpdir(), "oria-service-stub-"));
    try {
      for (const [name, script] of Object.entries({
        systemctl:
          '#!/bin/sh\nprintf "%s\\n" "$STUB_LOAD"\nexit "$STUB_CODE"\n',
        "systemd-run": '#!/bin/sh\nprintf "%s\\n" "LAUNCH" "$@"\n',
      })) {
        const file = join(dir, name);
        writeFileSync(file, script);
        chmodSync(file, 0o700);
      }
      const preset = builtinServiceTemplates.find(
        (p) => p.id === "dsh-systemd",
      )!;
      const result = applyLaunchTemplate(
        base("oria-dsh.service"),
        preset,
        preset.launch,
      );
      const run = (kind: string, load: string, code: string) =>
        spawnSync(
          posixShell,
          ["-c", result.actions.find((a) => a.kind === kind)!.command],
          {
            encoding: "utf8",
            env: { PATH: dir, STUB_LOAD: load, STUB_CODE: code },
          },
        );
      expect(run("status", "not-found", "1").status).toBe(3);
      const restarted = run("restart", "not-found", "1");
      expect(restarted.status).toBe(0);
      expect(restarted.stdout).toContain(
        "LAUNCH\n--user\n--unit\noria-dsh.service",
      );
      expect(run("status", "", "1").status).toBe(5);
      expect(run("restart", "", "1").status).toBe(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
  it("escapes dollar signs for the service manager without requiring systemd 254", () => {
    const preset = builtinServiceTemplates.find((p) => p.id === "dsh-systemd")!;
    const result = applyLaunchTemplate(base("oria-dsh.service"), preset, {
      executable: "dsh",
      arguments: [{ name: "--path", value: "$HOME/$(id)/%n" }],
    });
    expect(result.actions[0].invocation?.arguments.at(-1)?.value).toBe(
      "$$HOME/$$(id)/%n",
    );
    expect(result.actions[0].command).not.toContain("--expand-environment");
  });
  it("uses a direct dsh foreground command on port 3080 and a native VNC daemon", () => {
    const preset = builtinServiceTemplates.find((p) => p.id === "dsh")!;
    expect(preset.icon).toBe("dsh");
    expect(preset.category).toBe("inference");
    expect(renderInvocation(preset.launch!)).toBe(
      "'dsh' 'web' '--port' '3080'",
    );
    const dsh = applyLaunchTemplate(base("unused"), preset, preset.launch);
    expect(dsh.actions).toHaveLength(1);
    expect(dsh.actions[0]).toMatchObject({ mode: "terminal", timeoutSecs: 0 });
    const vncPreset = builtinServiceTemplates.find((p) => p.id === "vnc")!;
    const vnc = applyLaunchTemplate(
      base("unused"),
      vncPreset,
      vncPreset.launch,
    );
    expect(vnc.actions[0]).toMatchObject({
      command: "'vncserver' ':1' '-localhost' 'yes'",
      mode: "command",
    });
    expect(vnc.actions.find((a) => a.kind === "stop")?.command).toBe(
      "'vncserver' '-kill' ':1'",
    );
    expect(vnc.actions[0].command).not.toContain("-fg");
  });
  it("passes native launch arguments and environment literally without service-manager escaping", () => {
    const dir = mkdtempSync(join(tmpdir(), "oria-direct-launch-"));
    try {
      const stub = join(dir, "dsh");
      writeFileSync(stub, '#!/bin/sh\nprintf "%s\\0" "$MODEL" "$@"\n');
      chmodSync(stub, 0o700);
      const preset = builtinServiceTemplates.find((p) => p.id === "dsh")!;
      const invocation = {
        ...preset.launch!,
        environment: [{ name: "MODEL", value: "$HOME ' 中文" }],
        arguments: [
          { name: "", value: "web" },
          { name: "--path", value: "$(id) $MODEL %n" },
        ],
      };
      const result = applyLaunchTemplate(base("unused"), preset, invocation);
      const start = result.actions[0];
      expect(start).toMatchObject({ mode: "terminal", timeoutSecs: 0 });
      const output = execFileSync(posixShell, ["-c", start.command], {
        env: { PATH: dir },
      })
        .toString()
        .split("\0")
        .slice(0, -1);
      expect(output).toEqual([
        "$HOME ' 中文",
        "web",
        "--path",
        "$(id) $MODEL %n",
      ]);
      start.invocation!.environment![0].value = "edited";
      expect(invocation.environment[0].value).toBe("$HOME ' 中文");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("exposes services as a page with decorated cards and editable command structure", () => {
    const html = renderToStaticMarkup(
      <PresetCommandProvider data={snapshot} onSnapshot={() => {}} page>
        <ServicesPage />
      </PresetCommandProvider>,
    );
    expect(html).toContain("services-page");
    expect(html).toContain("Model service");
    expect(html).toContain("Launch");
    expect(html).toContain("service-command-summary");
    expect(html).toContain("service-select");
    expect(html).toContain("lucide-copy-plus");
    expect(html).toContain(
      `${i18n.t("copyService", { ns: "commands" })} Model service`,
    );
    expect(html).toContain(
      `${i18n.t("details", { ns: "tunnel" })} Model service`,
    );
    expect(html).toContain(i18n.t("batch.selectAll", { ns: "commands" }));
    expect(html).toContain(i18n.t("batch.exportAll", { ns: "commands" }));
    expect(html).not.toContain('role="dialog"');
    const editor = renderToStaticMarkup(
      <ServiceEditor
        service={service}
        data={snapshot}
        busy={false}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(editor).toContain("connection-color-palette");
    expect(editor).toContain("connection-icon-picker");
    expect(editor).toContain(i18n.t("serviceColor", { ns: "commands" }));
    expect(editor).toContain(i18n.t("serviceIcon", { ns: "commands" }));
    expect(
      editor.indexOf(i18n.t("templates.import", { ns: "commands" })),
    ).toBeLessThan(editor.indexOf("<form"));
    expect(editor).not.toContain(i18n.t("connectionColor", { ns: "tunnel" }));
    expect(editor).not.toContain(i18n.t("selectHostSearch", { ns: "tunnel" }));
    expect(editor).not.toContain(i18n.t("linkedForwards", { ns: "commands" }));
    expect(html).not.toMatch(/<button[^>]*>Launch<\/button>/);

    expect(editor).toContain(i18n.t("builder.title", { ns: "commands" }));
  });
  it("can save a command template with no hosts or forward references", () => {
    const unbound = { ...service, executionHostId: "", ruleIds: [] };
    const html = renderToStaticMarkup(
      <ServiceEditor
        service={unbound}
        data={{ ...snapshot, hosts: [], rules: [] }}
        busy={false}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    const save = html.match(/<button[^>]*type="submit"[^>]*>/)?.[0];
    expect(save).toBeDefined();
    expect(save).not.toMatch(/\sdisabled(?:=|\s|>)/);
  });
  it("renders bound service chips in the forward editor without changing its SSH host", () => {
    const html = renderToStaticMarkup(
      <RuleEditor
        draft={snapshot.rules[0]}
        hosts={[host]}
        services={[service]}
        busy={false}
        reconnect={false}
        onChange={() => {}}
        onAddHost={() => {}}
        onManageHosts={() => {}}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain("combobox-chip");
    expect(html).toContain("Model service");
    expect(html).toContain("hostId");
  });
});
