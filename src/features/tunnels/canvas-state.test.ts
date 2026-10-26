import { describe, expect, it } from "vitest";
import { applyNodeChanges, Position, type Node } from "@xyflow/react";
import {
  canvasLayout,
  localPortSide,
  localCardSize,
  reconcileCanvasNodes,
} from "./canvas-state";
import { emptyHost, emptyRule } from "./rule-model";
import { groupPositions, groupRulesByHost } from "./rule-groups";

const initial = (): Node[] => [
  { id: "local", position: { x: 0, y: 0 }, data: { sent: 0 } },
  { id: "host:a", position: { x: 480, y: 0 }, data: { sent: 0 } },
];
describe("canvas state across dragging and runtime snapshots", () => {
  it("retains the entire node collection when no rendered fact or geometry changed", () => {
    const nodes = initial();
    expect(reconcileCanvasNodes(nodes, structuredClone(nodes))).toBe(nodes);
    expect(reconcileCanvasNodes([], [])).toEqual([]);
  });
  it("keeps local and unrelated host nodes intact while another host receives live metrics", () => {
    const callback = () => {};
    const a = { sent: 0 },
      b = { sent: 0 };
    let nodes: Node[] = [
      {
        id: "local",
        position: { x: 0, y: 0 },
        data: { onStart: callback, ports: [] },
      },
      {
        id: "host:a",
        position: { x: 480, y: 0 },
        data: { onStart: callback, runtimes: [a] },
      },
      {
        id: "host:b",
        position: { x: 480, y: 300 },
        data: { onStart: callback, runtimes: [b] },
      },
    ];
    const local = nodes[0],
      other = nodes[2];
    for (let frame = 1; frame <= 60; frame++) {
      const incoming = nodes.map((node) => ({
        ...node,
        position: { ...node.position },
        data: {
          ...node.data,
          ...(node.id === "host:a"
            ? { runtimes: [{ sent: frame }] }
            : node.id === "host:b"
              ? { runtimes: [b] }
              : { ports: [] }),
        },
      }));
      nodes = reconcileCanvasNodes(nodes, incoming);
      expect(nodes[0]).toBe(local);
      expect(nodes[2]).toBe(other);
      expect((nodes[1].data.runtimes as (typeof a)[])[0].sent).toBe(frame);
    }
  });
  it("routes local endpoints to all four sides and reserves space for their labels", () => {
    const local = { x: 100, y: 100 };
    expect(localPortSide(local, { x: 600, y: 150 })).toBe(Position.Right);
    expect(localPortSide(local, { x: -400, y: 150 })).toBe(Position.Left);
    expect(localPortSide(local, { x: 150, y: -400 })).toBe(Position.Top);
    expect(localPortSide(local, { x: 150, y: 600 })).toBe(Position.Bottom);
    expect(localCardSize([])).toEqual({ width: 200, height: 164 });
    const ports = [
      Position.Top,
      Position.Bottom,
      Position.Left,
      Position.Right,
    ].flatMap((side) => Array.from({ length: 8 }, () => ({ side })));
    const size = localCardSize(ports);
    expect(size.width / 9).toBeGreaterThanOrEqual(64);
    expect(size.height / 9).toBeGreaterThanOrEqual(30);
  });
  it("grows independently for hundreds of ports on any side and shrinks after removal", () => {
    const ports = (side: Position, count: number) =>
      Array.from({ length: count }, () => ({ side }));
    for (const count of [1, 50, 100, 500]) {
      for (const side of [Position.Top, Position.Bottom]) {
        const size = localCardSize(ports(side, count));
        expect(size.width / (count + 1)).toBeGreaterThanOrEqual(64);
        expect(size.height).toBe(164);
      }
      for (const side of [Position.Left, Position.Right]) {
        const size = localCardSize(ports(side, count));
        expect(size.height / (count + 1)).toBeGreaterThanOrEqual(30);
        expect(size.width).toBe(200);
      }
    }
    const mixed = localCardSize([
      ...ports(Position.Top, 120),
      ...ports(Position.Right, 200),
    ]);
    expect(mixed.width / 121).toBeGreaterThanOrEqual(64);
    expect(mixed.height / 201).toBeGreaterThanOrEqual(30);
    expect(localCardSize([])).toEqual({ width: 200, height: 164 });
  });
  it("retains measured dimensions and selection throughout a long drag with fresh runtime data", () => {
    let nodes = applyNodeChanges(
      [
        {
          id: "local",
          type: "dimensions",
          dimensions: { width: 310, height: 300 },
        },
        {
          id: "host:a",
          type: "dimensions",
          dimensions: { width: 310, height: 460 },
        },
        { id: "host:a", type: "select", selected: true },
      ],
      initial(),
    );
    const dimensions = nodes[1].measured;
    for (let frame = 1; frame <= 180; frame++) {
      const position = { x: 480 - frame * 5, y: frame * 2 };
      nodes = applyNodeChanges(
        [{ id: "host:a", type: "position", position, dragging: true }],
        nodes,
      );
      if (frame % 2 === 0) {
        nodes = reconcileCanvasNodes(
          nodes,
          initial().map((node) => ({ ...node, data: { sent: frame } })),
        );
        expect(nodes[1].data.sent).toBe(frame);
      }
      expect(nodes[1].position).toEqual(position);
      expect(nodes[1].measured).toBe(dimensions);
      expect(nodes[1].selected).toBe(true);
      expect(nodes[1].dragging).toBe(true);
      expect(
        nodes.every((node) => node.measured?.width && node.measured?.height),
      ).toBe(true);
    }
    nodes = applyNodeChanges(
      [
        {
          id: "host:a",
          type: "position",
          position: nodes[1].position,
          dragging: false,
        },
      ],
      nodes,
    );
    const saved = canvasLayout(nodes, {});
    nodes = reconcileCanvasNodes(
      nodes,
      initial().map((node) => ({ ...node, position: saved[node.id] })),
    );
    expect(nodes[1].position).toEqual({ x: -420, y: 360 });
    expect(nodes[1].measured).toBe(dimensions);
    expect(nodes[1].dragging).toBe(false);
  });
  it("accepts dimension changes, adds and removes profiles without clearing existing geometry", () => {
    const current = applyNodeChanges(
      [
        {
          id: "local",
          type: "dimensions",
          dimensions: { width: 310, height: 420 },
        },
      ],
      initial(),
    );
    const incoming = [
      initial()[0],
      { id: "host:b", position: { x: 480, y: 50 }, data: {} },
    ];
    const merged = reconcileCanvasNodes(current, incoming);
    expect(merged.map((node) => node.id)).toEqual(["local", "host:b"]);
    expect(merged[0].measured).toEqual({ width: 310, height: 420 });
    expect(merged[1].measured).toBeUndefined();
    expect(current).toHaveLength(2);
    expect(incoming[0].measured).toBeUndefined();
    const resized = applyNodeChanges(
      [
        {
          id: "local",
          type: "dimensions",
          dimensions: { width: 310, height: 520 },
        },
      ],
      merged,
    );
    expect(reconcileCanvasNodes(resized, incoming)[0].measured?.height).toBe(
      520,
    );
  });
  it("commits all current card positions so moving local does not relayout untouched hosts", () => {
    const moved = applyNodeChanges(
      [
        {
          id: "local",
          type: "position",
          position: { x: 300, y: 150 },
          dragging: false,
        },
      ],
      initial(),
    );
    const saved = canvasLayout(moved, { "host:deleted": { x: 100, y: 200 } });
    const groups = groupRulesByHost(
      [{ ...emptyRule("a"), id: "forward" }],
      [{ ...emptyHost(), id: "a" }],
    );
    expect(groupPositions(groups, saved)["host:a"]).toEqual({ x: 480, y: 0 });
    expect(saved.local).toEqual({ x: 300, y: 150 });
    expect(saved["host:deleted"]).toEqual({ x: 100, y: 200 });
    expect(initial()[0].position).toEqual({ x: 0, y: 0 });
  });
});
