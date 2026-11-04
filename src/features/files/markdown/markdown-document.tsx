import { isValidElement, memo, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { remarkInlineExtensions } from "@/lib/markdown/remark-inline-extensions";
import { ExternalLink } from "@/components/ui/external-link";
import { Kbd } from "@/components/ui/kbd";
import { MarkdownBlockquote } from "./markdown-callout";
import { StructuredFence } from "./structured-fence";
import { RichSurface } from "./rich-surface";
import { useTranslation } from "react-i18next";
import { isNumericText } from "@/lib/markdown/structured-code";
import "katex/dist/katex.min.css";
import "./markdown.css";

export function codeText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (Array.isArray(value)) return value.map(codeText).join("");
  if (isValidElement<{ children?: ReactNode }>(value))
    return codeText(value.props.children);
  return "";
}
export function documentUrl(url: string, image = false) {
  if (/^#[\w:.-]+$/.test(url)) return url;
  if (image && /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=]+$/i.test(url) && url.length < 3_000_000) return url;
  try {
    const u = new URL(url);
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : "";
  } catch {
    return "";
  }
}

export const MarkdownDocument = memo(function MarkdownDocument({
  content,
}: {
  content: string;
}) {
  const { t } = useTranslation();
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children, node: _node, ...props }) =>
        href?.startsWith("#") ? (
          <a {...props} href={href}>{children}</a>
        ) : href ? (
          <ExternalLink {...props} href={href}>{children}</ExternalLink>
        ) : (
          <span>{children}</span>
        ),
      blockquote: MarkdownBlockquote,
      code: ({ children, className, node: _node, ...props }) =>
        !className && isKeyboardShortcut(codeText(children).trim()) ? (
          <Kbd>{children}</Kbd>
        ) : (
          <code {...props} className={className}>
            {children}
          </code>
        ),
      pre: ({ children }) => {
        const child = isValidElement<{ className?: string }>(children)
          ? children
          : null;
        return (
          <StructuredFence
            source={codeText(children).replace(/\n$/, "")}
            language={
              child?.props.className?.match(/language-(\S+)/)?.[1] || "text"
            }
          />
        );
      },
      table: ({ children }) => (
        <RichSurface title={t("markdown.table")}>
          <div className="markdown-table-scroll">
            <table>{children}</table>
          </div>
        </RichSurface>
      ),
      td: ({ children, node: _node, ...props }) => (
        <td
          {...props}
          data-numeric={isNumericText(codeText(children)) || undefined}
        >
          {children}
        </td>
      ),
      img: ({ src, alt }) =>
        src ? (
          <RichSurface title={alt || t("markdown.svgPreview")} inline>
            <span className="markdown-image">
              <img
                src={src}
                alt={alt || ""}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            </span>
          </RichSurface>
        ) : (
          <span>{alt}</span>
        ),
    }),
    [t],
  );
  return (
    <div className="markdown-document" data-selectable="true">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkInlineExtensions]}
        rehypePlugins={[[rehypeKatex, { trust: false, strict: "ignore" }]]}
        components={components}
        skipHtml
        urlTransform={(url, key) => documentUrl(url, key === "src")}
      >
        {normalizeDisplayMath(content)}
      </ReactMarkdown>
    </div>
  );
});
export default MarkdownDocument;

function isKeyboardShortcut(value: string) {
  if (!value.includes("+") || value.length > 40) return false;
  const key =
    /^(?:Cmd|Command|⌘|Ctrl|Control|Alt|Option|⌥|Shift|Enter|Return|Esc|Escape|Tab|Space|Backspace|Delete|Del|Arrow(?:Up|Down|Left|Right)|F(?:[1-9]|1[0-2])|[A-Z0-9])$/i;
  const parts = value.split("+").map((part) => part.trim());
  return (
    parts.length >= 2 &&
    parts.length <= 5 &&
    parts.every((part) => key.test(part))
  );
}

function normalizeDisplayMath(content: string) {
  const lines = content.split(/\r?\n/);
  const normalized: string[] = [];
  let codeFence: { marker: "`" | "~"; length: number } | null = null;
  let displayMathOpen = false;
  let blankAfterDisplayMath = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);

    if (fenceMatch) {
      const marker = fenceMatch[1][0] as "`" | "~";
      if (!codeFence) {
        codeFence = { marker, length: fenceMatch[1].length };
      } else if (
        codeFence.marker === marker &&
        fenceMatch[1].length >= codeFence.length
      ) {
        codeFence = null;
      }
    }

    if (!codeFence && !displayMathOpen && trimmed.startsWith("$$")) {
      if (normalized.length > 0 && normalized[normalized.length - 1]?.trim())
        normalized.push("");

      const singleLineDisplay = trimmed.length > 4 && trimmed.endsWith("$$");
      if (singleLineDisplay) {
        const indentation = line.slice(0, line.indexOf("$$"));
        normalized.push(
          `${indentation}$$`,
          trimmed.slice(2, -2),
          `${indentation}$$`,
        );
        blankAfterDisplayMath = true;
      } else {
        normalized.push(line);
        displayMathOpen = true;
      }
      continue;
    }

    if (!codeFence && displayMathOpen) {
      normalized.push(line);
      if (trimmed.includes("$$")) {
        displayMathOpen = false;
        blankAfterDisplayMath = true;
      }
      continue;
    }

    if (
      blankAfterDisplayMath &&
      trimmed &&
      normalized[normalized.length - 1]?.trim()
    ) {
      normalized.push("");
    }
    if (trimmed) blankAfterDisplayMath = false;
    normalized.push(line);
  }

  return normalized.join("\n");
}
