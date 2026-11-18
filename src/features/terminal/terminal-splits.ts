export type SplitSide = "left" | "right" | "top" | "bottom";
export type PaneTree =
  | string
  | {
      id: string;
      axis: "horizontal" | "vertical";
      firstSize?: number;
      first: PaneTree;
      second: PaneTree;
    };
export interface TerminalGroup {
  // The target tab keeps its position and identity when another pane joins it.
  tab: string;
  tree: PaneTree;
}
export type PaneDrop =
  | { scope: "pane" | "group"; target: string; side: SplitSide }
  | "tabs";

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
  const { target, scope, side } = drop;
  const destination = groups.find((group) =>
    scope === "group"
      ? group.tab === target
      : paneKeys(group.tree).includes(target),
  );
  if (!destination || (scope === "pane" && source === target)) return groups;
  if (scope === "group" && alreadyAtEdge(destination.tree, source, side))
    return groups;
  const remaining = keepPanes(destination.tree, (key) => key !== source);
  if (!remaining) return groups;

  const before = side === "left" || side === "top";
  const axis = splitAxis(side);
  function insert(tree: PaneTree): PaneTree {
    if (scope === "group" || tree === target) {
      const share = dockShare(tree, side);
      return {
        id: splitId,
        axis,
        ...(share !== 50 && { firstSize: before ? share : 100 - share }),
        first: before ? source : tree,
        second: before ? tree : source,
      };
    }
    if (typeof tree === "string") return tree;
    const first = insert(tree.first),
      second = insert(tree.second);
    return first === tree.first && second === tree.second
      ? tree
      : { ...tree, first, second };
  }
  return groups.flatMap((group) => {
    if (group === destination)
      return [{ tab: group.tab, tree: insert(remaining) }];
    return group === origin
      ? filterGroups([group], (key) => key !== source)
      : [group];
  });
}

function splitAxis(side: SplitSide) {
  return side === "left" || side === "right" ? "horizontal" : "vertical";
}

// Count adjacent columns (or rows) as peers, preserving their internal ratios.
function dockShare(tree: PaneTree, side: SplitSide) {
  const axis = splitAxis(side);
  function tracks(node: PaneTree): number {
    return typeof node === "string" || node.axis !== axis
      ? 1
      : tracks(node.first) + tracks(node.second);
  }
  return Math.max(12, 100 / (1 + tracks(tree)));
}

function alreadyAtEdge(tree: PaneTree, source: string, side: SplitSide) {
  if (typeof tree === "string") return tree === source;
  const before = side === "left" || side === "top";
  return (
    tree.axis === splitAxis(side) &&
    (before ? tree.first : tree.second) === source
  );
}

export function groupPreviewShare(
  tree: PaneTree,
  source: string,
  side: SplitSide,
) {
  if (alreadyAtEdge(tree, source, side)) return null;
  const remaining = keepPanes(tree, (key) => key !== source);
  return remaining ? dockShare(remaining, side) : 50;
}

type DropRect = Pick<DOMRect, "left" | "top" | "width" | "height">;

export function groupEdge(
  rect: DropRect,
  x: number,
  y: number,
): SplitSide | null {
  const dx = x - rect.left;
  const dy = y - rect.top;
  const horizontal = Math.min(dx, rect.width - dx);
  const vertical = Math.min(dy, rect.height - dy);
  if (Math.min(horizontal, vertical) < 0) return null;
  // Leave the interior available for splitting even a small individual pane.
  const band = Math.min(32, rect.width / 8, rect.height / 8);
  if (Math.min(horizontal, vertical) > band) return null;
  if (horizontal < vertical) return dx < rect.width / 2 ? "left" : "right";
  return dy < rect.height / 2 ? "top" : "bottom";
}

export function splitSide(rect: DropRect, x: number, y: number): SplitSide {
  const horizontal = (x - rect.left) / rect.width;
  const vertical = (y - rect.top) / rect.height;
  if (Math.min(horizontal, 1 - horizontal) < Math.min(vertical, 1 - vertical))
    return horizontal < 0.5 ? "left" : "right";
  return vertical < 0.5 ? "top" : "bottom";
}
