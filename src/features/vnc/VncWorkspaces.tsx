import { Channel, invoke } from "@tauri-apps/api/core";
import { createContext, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Host, TerminalSession } from "@/types";
import type { Snapshot as FileSnapshot } from "@/features/files/api";
import { Toaster } from "@/components/ui/toast";
import { FileWorkspaceProvider } from "@/features/files/file-workspace";
import { TerminalWorkspaceProvider } from "@/features/terminal/terminal-workspace";

type Hosts = {
  hosts: Host[];
  addedHostIds: string[];
  preferred: string | null;
  revision: number;
};
type Update =
  | { type: "hosts"; data: Hosts }
  | { type: "terminals"; data: TerminalSession[] }
  | { type: "files"; data: FileSnapshot }
  | { type: "drop"; data: unknown };

export const VncHostsReady = createContext(false);

export function VncWorkspaces({ children }: { children: ReactNode }) {
  const { t } = useTranslation("terminal");
  const [hosts, setHosts] = useState<Hosts>({
    hosts: [],
    addedHostIds: [],
    preferred: null,
    revision: -1,
  });
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const [files, setFiles] = useState<FileSnapshot>({
    sessions: [],
    tasks: [],
    warning: null,
    revision: 0,
  });
  const [error, setError] = useState("");
  const [chosenHost, setChosenHost] = useState("");
  const preferredHost =
    hosts.preferred ??
    (hosts.addedHostIds.includes(chosenHost) ? chosenHost : undefined);
  useEffect(() => {
    let live = true;
    const updates = new Channel<Update>();
    updates.onmessage = (update) => {
      if (!live) return;
      switch (update.type) {
        case "hosts":
          setHosts((old) =>
            old.revision <= update.data.revision ? update.data : old,
          );
          break;
        case "terminals":
          setTerminals(update.data);
          break;
        case "files":
          setFiles((old) =>
            old.revision <= update.data.revision ? update.data : old,
          );
          break;
        case "drop":
          window.dispatchEvent(
            new CustomEvent("oria-workspace-drop", { detail: update.data }),
          );
          break;
      }
    };
    void invoke("vnc_workspace_watch", { updates }).catch((e) => {
      if (live) setError(String(e));
    });
    return () => {
      live = false;
    };
  }, []);
  return (
    <TerminalWorkspaceProvider
      data={{ ...hosts, rules: [] }}
      preferredHost={preferredHost}
      onChooseHost={setChosenHost}
      viewerSessions={terminals}
    >
      <FileWorkspaceProvider
        data={hosts}
        preferredHost={preferredHost}
        onChooseHost={setChosenHost}
        viewerSnapshot={files}
      >
        <VncHostsReady.Provider value={hosts.revision >= 0}>
          {children}
        </VncHostsReady.Provider>
        {error && (
          <div role="alert" className="vnc-error">
            {error}
          </div>
        )}
        <Toaster closeLabel={t("cancel")} />
      </FileWorkspaceProvider>
    </TerminalWorkspaceProvider>
  );
}
