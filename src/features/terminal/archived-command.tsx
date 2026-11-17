import { memo, useCallback, useRef, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useWindowDetail } from "./virtual-output";
import { CommandHeader } from "./command-editor";
import type { CommandBlock } from "./shell-editor";
import { TerminalOutput } from "./terminal-output";

export const ArchivedCommand = memo(function ArchivedCommand({
  block,
  index,
  deferLayout,
  measure,
  commandFolded,
  limited,
  autoLimit,
  toggleCommand,
  toggleOutput,
  copy,
  focus,
}: {
  block: CommandBlock;
  deferLayout: boolean;
  measure?: (node: HTMLElement | null) => void;
  index: number;
  commandFolded: boolean;
  limited: boolean;
  autoLimit?: (id: number) => void;
  toggleCommand: (id: number) => void;
  toggleOutput: (id: number) => void;
  copy: (text: string) => Promise<void>;
  focus: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const bind = useCallback(
    (node: HTMLElement | null) => {
      ref.current = node;
      measure?.(node);
    },
    [measure],
  );
  const detailed = useWindowDetail(!deferLayout, ref);
  return (
    <section
      ref={bind}
      data-index={index}
      data-command-block={block.id}
      className="shell-block"
      data-output-folded={limited || undefined}
      data-defer-history={deferLayout || undefined}
    >
      <div className="shell-sticky">
        <CommandHeader
          prompt={block}
          copy={copy}
          readCopy={() => block}
          focus={focus}
          command={block.command}
          commandFolded={commandFolded}
          toggleCommand={() => toggleCommand(block.id)}
          limited={limited}
          toggleOutput={block.output ? () => toggleOutput(block.id) : undefined}
        />
        {block.command && !commandFolded && (
          <pre tabIndex={-1} className="shell-command" data-selectable="true">
            $ {block.command}
          </pre>
        )}
      </div>
      {block.output && !commandFolded && (
        <TerminalOutput
          detailed={detailed}
          text={block.output}
          runs={block.runs}
          limited={limited}
          autoLimit={autoLimit}
          blockId={block.id}
        />
      )}
    </section>
  );
});

export const CommandHistory = memo(function CommandHistory({
  blocks,
  pane,
  latestCommand,
  foldedCommands,
  limitedOutputs,
  autoLimit,
  ...controls
}: {
  blocks: CommandBlock[];
  pane: RefObject<HTMLDivElement | null>;
  latestCommand?: number;
  foldedCommands: ReadonlyMap<number, boolean>;
  limitedOutputs: ReadonlyMap<number, boolean>;
  autoLimit: (id: number) => void;
  toggleCommand: (id: number) => void;
  toggleOutput: (id: number) => void;
  copy: (text: string) => Promise<void>;
  focus: () => void;
}) {
  const windowed = blocks.length > 24;
  const keys = useCallback((i: number) => blocks[i].id, [blocks]);
  const list = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: blocks.length,
    enabled: windowed,
    getScrollElement: () => pane.current,
    estimateSize: () => 66,
    getItemKey: keys,
    overscan: 8,
    useFlushSync: true,
  });
  // The browser positions real text in normal flow and owns scroll anchoring.
  list.shouldAdjustScrollPositionOnItemSizeChange = () => false;
  const items = list.getVirtualItems();
  const first = items[0]?.index ?? 0,
    last = items.at(-1)?.index ?? blocks.length - 1;
  return (
    <>
      {blocks.map((block, index) => (
        <ArchivedCommand
          key={block.id}
          block={block}
          index={index}
          deferLayout={windowed && (index < first || index > last)}
          measure={windowed ? list.measureElement : undefined}
          commandFolded={!!foldedCommands.get(block.id)}
          limited={!!limitedOutputs.get(block.id)}
          autoLimit={
            block.command &&
            block.id !== latestCommand &&
            !limitedOutputs.has(block.id)
              ? autoLimit
              : undefined
          }
          {...controls}
        />
      ))}
    </>
  );
});
