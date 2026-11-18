export type SplitSide = "left" | "right" | "top" | "bottom";
export type PaneTree =
  | string
  | {
      id: string;
      axis: "horizontal" | "vertical";
      first: PaneTree;
      second: PaneTree;
    };
export interface TerminalGroup {
  // The target tab keeps its position and identity when another pane joins it.
  tab: string;
  tree: PaneTree;
}
export type PaneDrop = { pane: string; side: SplitSide } | "tabs";

export function paneKeys(tree: PaneTree): string[] {
  return typeof tree === "string"
    ? [tree]
    : [...paneKeys(tree.first), ...paneKeys(tree.second)];
}

function keepPanes(
  tree: PaneTree,
  keep: (key: string) => boolean,
): PaneTree | undefined {
  if (typeof tree === "string") return keep(tree) ? tree : undefined;
  const first = keepPanes(tree.first, keep);
  const second = keepPanes(tree.second, keep);
  if (!first || !second) return first ?? second;
  return first === tree.first && second === tree.second
    ? tree
    : { ...tree, first, second };
}

function filterGroups(groups: TerminalGroup[], keep: (key: string) => boolean) {
  return groups.flatMap((group) => {
    const tree = keepPanes(group.tree, keep);
    if (!tree) return [];
    if (tree === group.tree) return [group];
    return [{ tab: keep(group.tab) ? group.tab : paneKeys(tree)[0], tree }];
  });
}

export function reconcileGroups(groups: TerminalGroup[], keys: string[]) {
  const live = new Set(keys);
  const next = filterGroups(groups, (key) => live.has(key));
  const present = new Set(next.flatMap((group) => paneKeys(group.tree)));
  for (const key of keys) {
    if (!present.has(key)) next.push({ tab: key, tree: key });
  }
  return next.length === groups.length &&
    next.every((group, i) => group === groups[i])
    ? groups
    : next;
}

export function movePane(
  groups: TerminalGroup[],
  source: string,
  drop: PaneDrop,
  splitId: string,
) {
  const origin = groups.find((group) => paneKeys(group.tree).includes(source));
  if (!origin) return groups;
  if (drop === "tabs") {
    if (typeof origin.tree === "string") return groups;
    const next = filterGroups(groups, (key) => key !== source);
    next.splice(groups.indexOf(origin) + 1, 0, { tab: source, tree: source });
    return next;
  }
  const { pane, side } = drop;
  const target = groups.find((group) => paneKeys(group.tree).includes(pane));
  if (source === pane || !target) return groups;
  const before = side === "left" || side === "top";
  function insert(tree: PaneTree): PaneTree {
    if (tree === pane)
      return {
        id: splitId,
        axis: side === "left" || side === "right" ? "horizontal" : "vertical",
        first: before ? source : tree,
        second: before ? tree : source,
      };
    if (typeof tree === "string") return tree;
    const first = insert(tree.first),
      second = insert(tree.second);
    return first === tree.first && second === tree.second
      ? tree
      : { ...tree, first, second };
  }
  return filterGroups(groups, (key) => key !== source).map((group) => {
    const tree = insert(group.tree);
    return tree === group.tree ? group : { tab: target.tab, tree };
  });
}

export function splitSide(
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  x: number,
  y: number,
): SplitSide {
  const horizontal = (x - rect.left) / rect.width;
  const vertical = (y - rect.top) / rect.height;
  if (Math.min(horizontal, 1 - horizontal) < Math.min(vertical, 1 - vertical))
    return horizontal < 0.5 ? "left" : "right";
  return vertical < 0.5 ? "top" : "bottom";
}
