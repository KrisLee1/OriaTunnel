import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import type { RemoteService, Snapshot } from "@/types";
import i18n from "@/i18n";
import "@/tunnel-i18n";
import { emptyHost, emptyRule } from "@/features/tunnels/rule-model";
import {
  PresetCommandProvider,
  ServiceCommandsButton,
} from "./preset-commands";

const state = vi.hoisted(() => ({
  running: true,
  busy: false,
  stop: vi.fn(),
  items: new Map<string, { disabled: boolean; click: () => void }>(),
}));
vi.mock("@/lib/bridge", async (original) => ({
  ...(await original<typeof import("@/lib/bridge")>()),
  desktop: true,
}));
vi.mock("@/features/terminal/terminal-workspace", () => ({
  OpenTerminalButton: () => null,
  useTerminalWorkspace: () => ({
    busy: state.busy,
    serviceBusy: () => state.running,
    foregroundSession: (_: RemoteService, ruleId?: string) =>
      state.running && ruleId === "forward" ? { id: "terminal" } : undefined,
    stopService: state.stop,
  }),
}));
vi.mock("@/components/ui/dropdown-menu", () => {
  const container = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    DropdownMenu: container,
    DropdownMenuTrigger: container,
    DropdownMenuContent: container,
    DropdownMenuGroup: container,
    DropdownMenuLabel: container,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuItem: ({
      children,
      disabled,
      onClick,
    }: {
      children: string;
      disabled?: boolean;
      onClick: () => void;
    }) => {
      state.items.set(children, { disabled: !!disabled, click: onClick });
      return <button disabled={disabled}>{children}</button>;
    },
  };
});
const service = {
  id: "dsh",
  name: "DSH",
  revision: "rev",
  ruleIds: ["forward"],
  noLocalEnvironment: true,
  actions: [
    {
      id: "start",
      kind: "start",
      label: "Launch DSH",
      command: "dsh web --port 3080",
      mode: "terminal",
      timeoutSecs: 0,
      successCodes: [0],
      confirm: false,
    },
  ],
} satisfies RemoteService;
const render = (value: RemoteService = service, ruleId = "forward") =>
  renderToStaticMarkup(
    <PresetCommandProvider
      data={
        {
          services: [value],
          hosts: [{ ...emptyHost(), id: "host" }],
          rules: [{ ...emptyRule("host"), id: "forward" }],
          runtimes: [],
        } as unknown as Snapshot
      }
      onSnapshot={() => {}}
    >
      <ServiceCommandsButton ruleId={ruleId} />
    </PresetCommandProvider>,
  );
describe("foreground service stop", () => {
  beforeEach(() => {
    state.running = true;
    state.busy = false;
    state.items.clear();
    state.stop.mockReset();
  });
  it("keeps Stop enabled while Launch is busy and closes the exact service terminal instead of executing a shell action", () => {
    render();
    expect(state.items.get("Launch DSH")?.disabled).toBe(true);
    const stop = state.items.get(i18n.t("kind.stop", { ns: "commands" }))!;
    expect(stop.disabled).toBe(false);
    stop.click();
    expect(state.stop).toHaveBeenCalledExactlyOnceWith(service, "forward");
  });
  it("disables terminal Stop when there is no matching terminal or while closing", () => {
    state.running = false;
    render();
    expect(state.items.get("Launch DSH")?.disabled).toBe(false);
    expect(
      state.items.get(i18n.t("kind.stop", { ns: "commands" }))?.disabled,
    ).toBe(true);
    state.running = true;
    state.busy = true;
    render();
    expect(
      state.items.get(i18n.t("kind.stop", { ns: "commands" }))?.disabled,
    ).toBe(true);
    expect(state.stop).not.toHaveBeenCalled();
  });
  it("replaces a native stop command only while this foreground terminal is active", () => {
    const value: RemoteService = {
      ...service,
      actions: [
        ...service.actions,
        {
          id: "stop",
          kind: "stop",
          label: "Native stop",
          command: "native-stop",
          mode: "command",
          timeoutSecs: 60,
          successCodes: [0],
          confirm: true,
        },
      ],
    };
    render(value);
    expect(state.items.has("Native stop")).toBe(false);
    expect(
      state.items.get(i18n.t("kind.stop", { ns: "commands" }))?.disabled,
    ).toBe(false);
    state.items.clear();
    state.running = false;
    render(value);
    expect(state.items.has("Native stop")).toBe(true);
    expect(state.items.has(i18n.t("kind.stop", { ns: "commands" }))).toBe(
      false,
    );
  });
});
