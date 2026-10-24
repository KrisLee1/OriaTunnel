import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import "@/i18n";
import "@/tunnel-i18n";
import { emptyHost } from "@/features/tunnels/rule-model";
import type { Snapshot } from "@/types";
import * as bridge from "@/lib/bridge";
import {
  OpenTerminalButton,
  TerminalWorkspaceProvider,
  useTerminalWorkspace,
} from "./terminal-workspace";

vi.mock("@/lib/bridge", () => ({
  desktop: true,
  // Inspect the submitted intent and reject before any connection or session is created.
  openTerminal: vi.fn().mockRejectedValue("hostBlocked"),
}));

describe("host terminal entry", () => {
  it("submits the chosen host directly without a host-selection confirmation", async () => {
    const host = { ...emptyHost(), id: "chosen-host", name: "Chosen host" };
    let workspace: ReturnType<typeof useTerminalWorkspace> = null;
    function Entry() {
      workspace = useTerminalWorkspace();
      return <OpenTerminalButton hostId={host.id} />;
    }
    const html = renderToStaticMarkup(
      <TerminalWorkspaceProvider
        data={{ hosts: [host], rules: [], services: [] } as unknown as Snapshot}
      >
        <Entry />
      </TerminalWorkspaceProvider>,
    );
    expect(html).toContain("lucide-square-terminal");
    expect(bridge.openTerminal).not.toHaveBeenCalled();
    expect(workspace).not.toBeNull();
    await workspace!.openHost(host.id);
    expect(bridge.openTerminal).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        hostId: host.id,
        noLocalEnvironment: true,
        secrets: {},
        rememberHostIds: [],
      }),
    );
  });
});
