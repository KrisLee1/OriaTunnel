import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Code2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  CodeBlock,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockContent,
} from "@/components/ui/code-block";
import { FileCodePreview } from "../file-code-preview";
import {
  parseDelimitedPreview,
  isNumericText,
} from "@/lib/markdown/structured-code";
import { sanitizeAnimatedSvg } from "@/lib/markdown/safe-svg";
import { RichSurface } from "./rich-surface";
const Mermaid = lazy(() => import("./mermaid"));
const DataChart = lazy(() => import("./data-chart"));

class RenderBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function JsonTree({
  value,
  depth = 0,
  name,
}: {
  value: unknown;
  depth?: number;
  name?: string;
}) {
  const key =
    name !== undefined ? (
      <span className="markdown-json-key">{JSON.stringify(name)}: </span>
    ) : null;
  if (value === null || typeof value !== "object")
    return (
      <div className="markdown-json-primitive">
        {key}
        <span data-kind={typeof value}>{JSON.stringify(value)}</span>
      </div>
    );
  if (depth > 20) return <div>…</div>;
  const entries = Object.entries(value);
  const array = Array.isArray(value),
    start = array ? "[" : "{",
    end = array ? "]" : "}";
  if (!entries.length)
    return (
      <div>
        {key}
        {start}
        {end}
      </div>
    );
  return (
    <details
      className="markdown-json-branch"
      open={depth < 2 && entries.length <= 24}
    >
      <summary>
        {key}
        {start} {entries.length} {end}
      </summary>
      <div className="markdown-json-children">
        {entries.map(([name, value]) => (
          <JsonTree
            key={name}
            name={array ? undefined : name}
            value={value}
            depth={depth + 1}
          />
        ))}
      </div>
    </details>
  );
}
export function DataTable({ rows }: { rows: string[][] }) {
  return (
    <div className="markdown-table-scroll">
      <table>
        <thead>
          <tr>
            {rows[0].map((cell, i) => (
              <th key={i}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(1).map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} data-numeric={isNumericText(cell) || undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StructuredFence({
  source,
  language,
}: {
  source: string;
  language: string;
}) {
  const { t } = useTranslation();
  const [raw, setRaw] = useState(false),
    [near, setNear] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const toggle = (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={t("markdown.code")}
      aria-pressed={raw}
      onClick={() => setRaw(!raw)}
    >
      <Code2 />
    </Button>
  );
  const structured = [
    "json",
    "csv",
    "tsv",
    "mermaid",
    "svg",
    "aide-chart",
  ].includes(language);
  const plain = (
    <FileCodePreview
      code={source}
      language={language}
      actions={structured ? toggle : undefined}
    />
  );
  if (!near)
    return (
      <div ref={root}>
        <CodeBlock
          className="markdown-code-placeholder"
          style={
            {
              "--code-preview-lines": source.split("\n").length,
            } as import("react").CSSProperties
          }
        >
          <CodeBlockHeader>
            <CodeBlockTitle>{language}</CodeBlockTitle>
            <CodeBlockActions>
              <CodeBlockCopyButton value={source} />
            </CodeBlockActions>
          </CodeBlockHeader>
          <CodeBlockContent>{source.slice(0, 8000)}</CodeBlockContent>
        </CodeBlock>
      </div>
    );
  if (raw || source.length > 200_000 || !structured) return plain;
  let content: ReactNode = null;
  if (language === "json") {
    try {
      content = <JsonTree value={JSON.parse(source)} />;
    } catch {
      return plain;
    }
  }
  if (language === "csv" || language === "tsv") {
    const rows = parseDelimitedPreview(source, language === "tsv" ? "\t" : ",");
    if (!rows) return plain;
    content = (
      <RichSurface title={t("markdown.table")}>
        <DataTable rows={rows} />
      </RichSurface>
    );
  }
  if (language === "svg") {
    try {
      const svg = sanitizeAnimatedSvg(source);
      content = (
        <RichSurface title={t("markdown.svgPreview")}>
          <div
            className="markdown-diagram"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </RichSurface>
      );
    } catch {
      content = (
        <>
          <p role="alert">{t("markdown.svgError")}</p>
          {plain}
        </>
      );
    }
  }
  if (language === "mermaid")
    content = near ? (
      <Mermaid source={source} />
    ) : (
      <p>{t("markdown.renderingDiagram")}</p>
    );
  if (language === "aide-chart")
    content = near ? (
      <DataChart source={source} />
    ) : (
      <p>{t("markdown.renderingDiagram")}</p>
    );
  return (
    <CodeBlock className="markdown-structured" ref={root}>
      <CodeBlockHeader>
        <CodeBlockTitle>{language}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={source} />
          {toggle}
        </CodeBlockActions>
      </CodeBlockHeader>
      <div className="markdown-structured-body">
        <RenderBoundary key={source} fallback={plain}>
          <Suspense fallback={plain}>{content}</Suspense>
        </RenderBoundary>
      </div>
    </CodeBlock>
  );
}
