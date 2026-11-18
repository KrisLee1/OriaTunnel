import type { ComponentProps } from "react";
import type { ExtraProps } from "react-markdown";
import { ExternalLink } from "./external-link";

export function MarkdownLink({
  href,
  children,
  node: _node,
  ...props
}: ComponentProps<"a"> & ExtraProps) {
  if (!href) return <span>{children}</span>;
  if (href.startsWith("#"))
    return (
      <a {...props} href={href}>
        {children}
      </a>
    );
  return (
    <ExternalLink {...props} href={href}>
      {children}
    </ExternalLink>
  );
}
