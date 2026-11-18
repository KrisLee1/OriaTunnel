import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TabsContent } from "@/components/ui/tabs";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { paneKeys, type PaneTree, type TerminalGroup } from "./terminal-splits";

function PaneSlot({ host }: { host: HTMLElement }) {
  const attach = useCallback(
    (slot: HTMLDivElement | null) => {
      if (slot) slot.appendChild(host);
    },
    [host],
  );
  return <div className="terminal-pane-slot" ref={attach} />;
}

export function TerminalSplitPanels({
  groups,
  renderPane,
  label,
  resizeLabel,
}: {
  groups: TerminalGroup[];
  renderPane: (key: string, group: TerminalGroup) => ReactNode;
  label: (key: string) => string;
  resizeLabel: (axis: "horizontal" | "vertical") => string;
}) {
  // A session's portal container outlives the Resizable branches around it.
  // Reparenting that container preserves the editor, PTY subscription and xterm buffer.
  const hosts = useRef(new Map<string, HTMLDivElement>());
  const layouts = useRef(new Map<string, Record<string, number>>());
  const liveSplits = new Set<string>();
  const panes = groups.flatMap((group) =>
    paneKeys(group.tree).map((key) => ({ key, group })),
  );
  for (const { key } of panes) {
    if (!hosts.current.has(key)) {
      const host = document.createElement("div");
      host.className = "terminal-pane-host";
      hosts.current.set(key, host);
    }
  }
  useLayoutEffect(() => {
    const live = new Set(panes.map((pane) => pane.key));
    for (const key of hosts.current.keys())
      if (!live.has(key)) hosts.current.delete(key);
    for (const key of layouts.current.keys())
      if (!liveSplits.has(key)) layouts.current.delete(key);
  });
  function renderTree(tree: PaneTree): ReactNode {
    if (typeof tree === "string")
      return <PaneSlot host={hosts.current.get(tree)!} />;
    liveSplits.add(tree.id);
    return (
      <ResizablePanelGroup
        key={tree.id}
        orientation={tree.axis}
        defaultLayout={layouts.current.get(tree.id)}
        onLayoutChanged={(layout, meta) => {
          if (meta.isUserInteraction) layouts.current.set(tree.id, layout);
        }}
      >
        <ResizablePanel id={tree.id + "-first"} defaultSize="50%" minSize="12%">
          {renderTree(tree.first)}
        </ResizablePanel>
        <ResizableHandle aria-label={resizeLabel(tree.axis)} />
        <ResizablePanel
          id={tree.id + "-second"}
          defaultSize="50%"
          minSize="12%"
        >
          {renderTree(tree.second)}
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }
  return (
    <>
      {groups.map((group) => (
        <TabsContent
          className="terminal-group-panel"
          data-split={typeof group.tree !== "string" || undefined}
          keepMounted
          value={group.tab}
          key={group.tab}
          aria-label={label(group.tab)}
        >
          {renderTree(group.tree)}
        </TabsContent>
      ))}
      {panes.map(({ key, group }) =>
        createPortal(renderPane(key, group), hosts.current.get(key)!, key),
      )}
    </>
  );
}
