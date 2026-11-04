import {
  BadgeAlertIcon,
  CircleAlertIcon,
  InfoIcon,
  LightbulbIcon,
  ShieldAlertIcon,
  type LucideIcon,
} from "lucide-react";
import {
  Children,
  cloneElement,
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

type CalloutKind = "note" | "tip" | "important" | "warning" | "caution";

const calloutPattern = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

const calloutPresentation: Record<
  CalloutKind,
  {
    icon: LucideIcon;
    className: string;
  }
> = {
  note: { icon: InfoIcon, className: "markdown-callout-note" },
  tip: { icon: LightbulbIcon, className: "markdown-callout-tip" },
  important: { icon: BadgeAlertIcon, className: "markdown-callout-important" },
  warning: { icon: CircleAlertIcon, className: "markdown-callout-warning" },
  caution: { icon: ShieldAlertIcon, className: "markdown-callout-caution" },
};

export function MarkdownBlockquote({
  children,
  node: _node,
  ...props
}: ComponentProps<"blockquote"> & { node?: unknown }) {
  const { t } = useTranslation();
  const childArray = Children.toArray(children);
  const calloutIndex = childArray.findIndex((child) =>
    calloutPattern.test(nodeText(child)),
  );
  const first = childArray[calloutIndex];
  const firstText = nodeText(first);
  const match = firstText.match(calloutPattern);

  if (!match) return <blockquote {...props}>{children}</blockquote>;

  const kind = match[1].toLowerCase() as CalloutKind;
  const presentation = calloutPresentation[kind];
  const Icon = presentation.icon;
  const strippedFirst = stripLeadingText(first, match[0].length);

  return (
    <aside
      className={`markdown-callout ${presentation.className}`}
      role={kind === "warning" || kind === "caution" ? "alert" : "note"}
    >
      <div className="markdown-callout-title">
        <Icon aria-hidden="true" />
        <span>{t(`markdown.callout.${kind}`)}</span>
      </div>
      <div className="markdown-callout-body">
        {childArray.slice(0, calloutIndex)}
        {strippedFirst}
        {childArray.slice(calloutIndex + 1)}
      </div>
    </aside>
  );
}

function stripLeadingText(node: ReactNode, remaining: number): ReactNode {
  if (remaining <= 0) return node;
  if (typeof node === "string") return node.slice(remaining);
  if (
    typeof node === "number" ||
    node === null ||
    node === undefined ||
    typeof node === "boolean"
  ) {
    return node;
  }
  if (Array.isArray(node)) {
    let rest = remaining;
    return node.map((child) => {
      if (rest <= 0) return child;
      const length = nodeText(child).length;
      const result = stripLeadingText(child, rest);
      rest = Math.max(0, rest - length);
      return result;
    });
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return cloneElement(
      node,
      undefined,
      stripLeadingText(node.props.children, remaining),
    );
  }
  return node;
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return nodeText(node.props.children);
  return "";
}
