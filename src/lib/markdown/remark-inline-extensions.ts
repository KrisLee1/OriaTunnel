interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
  data?: {
    hName?: string;
  };
}

const ignoredNodeTypes = new Set(["code", "inlineCode", "math", "inlineMath"]);
const inlineExtensionPattern =
  /(?<![=])==([^=\n]*?\S)==(?![=])|(?<!~)~([^~\s]+)~(?!~)|(?<!\^)\^([^\^\s]+)\^(?!\^)/g;

/** Add the compact inline syntax commonly used in AI replies without enabling raw HTML. */
export function remarkInlineExtensions() {
  return (tree: MarkdownNode) => transformChildren(tree);
}

function transformChildren(parent: MarkdownNode) {
  if (!parent.children || ignoredNodeTypes.has(parent.type)) return;

  for (let index = 0; index < parent.children.length; index += 1) {
    const child = parent.children[index];
    if (child.type === "delete" && usesSingleTilde(child)) {
      child.type = "inlineExtension";
      child.data = { ...child.data, hName: "sub" };
      transformChildren(child);
      continue;
    }
    if (child.type === "text" && child.value) {
      const replacements = inlineExtensionNodes(child.value);
      if (replacements.length === 1 && replacements[0]?.type === "text")
        continue;
      parent.children.splice(index, 1, ...replacements);
      index += replacements.length - 1;
      continue;
    }
    transformChildren(child);
  }
}

function usesSingleTilde(node: MarkdownNode) {
  const firstChild = node.children?.[0];
  const nodeStart = node.position?.start.offset;
  const childStart = firstChild?.position?.start.offset;
  return (
    nodeStart !== undefined &&
    childStart !== undefined &&
    childStart - nodeStart === 1
  );
}

function inlineExtensionNodes(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let previousEnd = 0;

  inlineExtensionPattern.lastIndex = 0;
  for (const match of value.matchAll(inlineExtensionPattern)) {
    const start = match.index;
    if (start > previousEnd)
      nodes.push({ type: "text", value: value.slice(previousEnd, start) });
    const content = match[1] ?? match[2] ?? match[3];
    const tag =
      match[1] !== undefined ? "mark" : match[2] !== undefined ? "sub" : "sup";
    nodes.push({
      type: "inlineExtension",
      data: { hName: tag },
      children: [{ type: "text", value: content }],
    });
    previousEnd = start + match[0].length;
  }

  if (previousEnd === 0) return [{ type: "text", value }];
  if (previousEnd < value.length)
    nodes.push({ type: "text", value: value.slice(previousEnd) });
  return nodes;
}
