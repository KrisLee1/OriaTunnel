import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { WrapText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { loadHighlighter } from "@/lib/highlighter";
const CODE_CHUNK_LINES = 128;
const CODE_LINE_HEIGHT = 22;

type Highlighter = NonNullable<Awaited<ReturnType<typeof loadHighlighter>>>;
type GrammarState = Parameters<Highlighter["highlight"]>[1];

export function FileCodePreview({
  code,
  language,
  actions,
}: {
  code: string;
  language: string;
  actions?: ReactNode;
}) {
  const { t } = useTranslation("files");
  const { t: common } = useTranslation();
  const lines = useMemo(() => code.split("\n"), [code]);
  const columns = useMemo(
    () =>
      lines.map((line) => {
        const expanded = line.replace(/\t/g, "    ");
        return /[^\x00-\xff]/.test(expanded)
          ? Array.from(expanded).reduce(
              (n, char) => n + (char.codePointAt(0)! > 255 ? 2 : 1),
              0,
            )
          : expanded.length;
      }),
    [lines],
  );
  const maxColumns = useMemo(
    () => columns.reduce((max, n) => Math.max(max, n), 1),
    [columns],
  );
  const [dimensions, setDimensions] = useState({ width: 800, height: 400 });
  const [wrap, setWrap] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const wrapAnchor = useRef<number | null>(null);
  const gutter = Math.max(3, String(lines.length).length);
  const wrapColumns = Math.max(
    1,
    Math.floor((dimensions.width - 32 - (gutter + 3) * 7.8) / 7.8),
  );
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLSpanElement>({
    count: lines.length,
    getScrollElement: () => viewport.current,
    estimateSize: (index) =>
      wrap
        ? Math.max(1, Math.ceil(columns[index] / wrapColumns)) *
          CODE_LINE_HEIGHT
        : CODE_LINE_HEIGHT,
    initialRect: { width: 800, height: 400 },
    overscan: Math.max(24, Math.ceil(dimensions.height / CODE_LINE_HEIGHT) * 3),
    useFlushSync: true,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const range = {
    start: virtualRows[0]?.index || 0,
    end: (virtualRows[virtualRows.length - 1]?.index ?? -1) + 1,
    before: virtualRows[0]?.start || 0,
    after: Math.max(
      0,
      virtualizer.getTotalSize() -
        (virtualRows[virtualRows.length - 1]?.end || 0),
    ),
  };
  const [, repaint] = useState(0);
  const cache = useMemo(
    () => ({
      nodes: new Map<number, ReactNode[]>(),
      states: new Map<number, GrammarState>([[0, undefined]]),
    }),
    [code, language],
  );
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = () =>
      setDimensions({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  useLayoutEffect(() => {
    virtualizer.measure();
    viewport.current
      ?.querySelectorAll<HTMLSpanElement>("[data-index]")
      .forEach(virtualizer.measureElement);
    if (wrapAnchor.current !== null) {
      virtualizer.scrollToIndex(wrapAnchor.current, { align: "start" });
      wrapAnchor.current = null;
    }
  }, [wrap, dimensions.width]);
  useEffect(() => {
    if (language === "text") return;
    let cancelled = false;
    const startChunk = Math.floor(range.start / CODE_CHUNK_LINES);
    const endChunk = Math.ceil(range.end / CODE_CHUNK_LINES);
    void import("@/lib/highlighter")
      .then(async ({ loadHighlighter }) => {
        const highlighter = await loadHighlighter(language);
        if (!highlighter || cancelled) return;
        let first = startChunk;
        while (first > 0 && !cache.states.has(first)) first--;
        for (let chunk = first; chunk < endChunk && !cancelled; chunk++) {
          if (!cache.nodes.has(chunk) || !cache.states.has(chunk + 1)) {
            const source = lines
              .slice(chunk * CODE_CHUNK_LINES, (chunk + 1) * CODE_CHUNK_LINES)
              .join("\n");
            // Pathological single lines remain plain instead of blocking scrolling.
            const result =
              source.length <= 32_768
                ? highlighter.highlight(source, cache.states.get(chunk))
                : null;
            cache.states.set(chunk + 1, result?.state);
            if (chunk >= startChunk && result) {
              cache.nodes.set(chunk, result.lines);
              while (cache.nodes.size > 32)
                cache.nodes.delete(cache.nodes.keys().next().value!);
              startTransition(() => repaint((v) => v + 1));
            }
          }
          // Yield between chunks. Plain source is always already on screen.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cache, language, lines, range.start, range.end]);
  return (
    <CodeBlock
      className="files-preview-code"
      style={{ "--code-preview-lines": lines.length } as CSSProperties}
    >
      <CodeBlockHeader>
        <CodeBlockTitle>
          {language === "text" ? common("codeBlock.plainText") : language}
        </CodeBlockTitle>
        <span className="files-code-count">
          {t("codeLines", { count: lines.length })}
        </span>
        <CodeBlockActions>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={common("codeBlock.wrap")}
            title={common("codeBlock.wrap")}
            aria-pressed={wrap}
            onClick={() => {
              wrapAnchor.current =
                virtualRows.find(
                  (row) => row.end > (viewport.current?.scrollTop || 0),
                )?.index || 0;
              setWrap(!wrap);
            }}
          >
            <WrapText />
          </Button>
          <CodeBlockCopyButton value={code} />
          {actions}
        </CodeBlockActions>
      </CodeBlockHeader>
      <ScrollArea
        className="files-code-scroll"
        viewportRef={viewport}
        viewportClassName="files-code-viewport scroll-fade"
        contentClassName="files-code-content"
      >
        <CodeBlockContent
          className="files-code-lines"
          lineNumbers
          wrap={wrap}
          startLine={range.start + 1}
          data-selectable="true"
          aria-label={t("fileContent")}
          onKeyDown={(event) => {
            if (
              (event.ctrlKey || event.metaKey) &&
              (event.key === "Home" || event.key === "End")
            ) {
              event.preventDefault();
              virtualizer.scrollToIndex(
                event.key === "Home" ? 0 : lines.length - 1,
                { align: event.key === "Home" ? "start" : "end" },
              );
            }
          }}
          style={
            {
              minWidth: wrap
                ? undefined
                : `calc(${maxColumns}ch + ${gutter + 3}ch + 32px)`,
              "--files-code-gutter": `${gutter}ch`,
            } as CSSProperties
          }
        >
          <span
            aria-hidden="true"
            className="files-code-spacer"
            style={{ height: range.before }}
          />
          {virtualRows.map((row) => {
            const absolute = row.index;
            return (
              <CodeBlockLine
                ref={virtualizer.measureElement}
                key={row.key}
                data-index={absolute}
                data-line={absolute + 1}
                variant={
                  language === "diff" &&
                  !lines[absolute].startsWith("+++") &&
                  !lines[absolute].startsWith("---")
                    ? lines[absolute].startsWith("+")
                      ? "added"
                      : lines[absolute].startsWith("-")
                        ? "removed"
                        : "default"
                    : "default"
                }
              >
                {cache.nodes.get(Math.floor(absolute / CODE_CHUNK_LINES))?.[
                  absolute % CODE_CHUNK_LINES
                ] ?? lines[absolute]}
              </CodeBlockLine>
            );
          })}
          <span
            aria-hidden="true"
            className="files-code-spacer"
            style={{ height: range.after }}
          />
        </CodeBlockContent>
      </ScrollArea>
    </CodeBlock>
  );
}
