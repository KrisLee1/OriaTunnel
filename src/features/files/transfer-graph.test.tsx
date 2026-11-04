import "@/i18n";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlowProvider } from "@xyflow/react";
import { projectFileActivities } from "./transfer-state";
import { projectFileEdges } from "./transfer-graph";
import { FileTransferEdge } from "./transfer-edge";
import type { Task } from "./api";

const task: Task = {
  id: "copy",
  hostId: "b",
  hostName: "B",
  sessionId: "b-session",
  direction: "relay",
  transport: "direct",
  sourceRemote: {
    hostId: "a",
    hostName: "A",
    sessionId: "a-session",
    routeKey: "a-route",
    route: ["a"],
  },
  targetRemote: {
    hostId: "b",
    hostName: "B",
    sessionId: "b-session",
    routeKey: "b-route",
    route: ["b"],
  },
  sources: ["/data.txt"],
  target: "/dest",
  phase: "transferring",
  bytes: 1,
  speed: null,
  eta: null,
  total: 100,
  count: 1,
  completed: [],
  skipped: 0,
  revision: 1,
  error: null,
  conflict: null,
  temp: null,
  started: 1,
  finished: null,
};
const nodes = [
  { id: "host:a", position: { x: 0, y: 0 } },
  { id: "local", position: { x: 350, y: 0 } },
  { id: "host:b", position: { x: 700, y: 0 } },
];
describe("actual file activity on the connection graph", () => {
  it("updates hover task identities even when filenames, counts and phases are identical", () => {
    const before = projectFileEdges(projectFileActivities([task]), nodes);
    const after = projectFileEdges(
      projectFileActivities([{ ...task, id: "replacement" }]),
      nodes,
      before,
    );
    expect(after).not.toBe(before);
    expect(after[0].data?.taskIds).toEqual(["replacement"]);
  });
  it("draws one direct edge or two relay legs according to Rust's selected transport", () => {
    const direct = projectFileEdges(projectFileActivities([task]), nodes);
    expect(direct.map((edge) => [edge.source, edge.target])).toEqual([
      ["host:a", "host:b"],
    ]);
    const relay = projectFileEdges(
      projectFileActivities([{ ...task, transport: "relay" }]),
      nodes,
    );
    expect(relay.map((edge) => [edge.source, edge.target])).toEqual([
      ["host:a", "local"],
      ["local", "host:b"],
    ]);
    expect(relay.every((edge) => edge.data?.moving === true)).toBe(true);
  });
  it("reuses graph references for byte updates and stops animation on pause or completion", () => {
    const activity = projectFileActivities([task]);
    expect(
      projectFileActivities(
        [{ ...task, bytes: 90, speed: 40, revision: 2 }],
        activity,
      ),
    ).toBe(activity);
    const edges = projectFileEdges(activity, nodes);
    expect(projectFileEdges(activity, nodes, edges)).toBe(edges);
    const paused = projectFileEdges(
      projectFileActivities([{ ...task, phase: "paused" }]),
      nodes,
      edges,
    );
    expect(paused[0].data?.moving).toBe(false);
    expect(paused[0].data?.phase).toBe("paused");
    expect(projectFileActivities([{ ...task, phase: "completed" }])).toEqual(
      [],
    );
  });
  it("anchors to host headings rather than forwarding rows in tall or vertically stacked cards", () => {
    const stacked = [
      { id: "host:a", position: { x: 0, y: 0 }, height: 900 },
      { id: "host:b", position: { x: 0, y: 1200 }, height: 600 },
      { id: "local", position: { x: 350, y: 600 } },
    ];
    const [edge] = projectFileEdges(projectFileActivities([task]), stacked);
    expect(edge.source).toBe("host:a");
    expect(edge.target).toBe("host:b");
    expect(edge.sourceHandle).toBe("files-source-right");
    expect(edge.targetHandle).toBe("files-target-left");
    const [download] = projectFileEdges(
      projectFileActivities([
        {
          ...task,
          direction: "download",
          sourceRemote: task.sourceRemote,
          targetRemote: null,
          hostId: "a",
        },
      ]),
      stacked,
    );
    expect(download.sourceHandle).toBe("files-source-right");
    expect(download.target).toBe("local");
  });
  it("retains an unknown direct outcome without showing moving data or inventing invisible hosts", () => {
    const activities = projectFileActivities([
      { ...task, phase: "failed", directPending: true, error: "directUnknown" },
    ]);
    expect(projectFileEdges(activities, nodes)[0].data).toMatchObject({
      phase: "directUnknown",
      moving: false,
      relay: false,
    });
    expect(projectFileEdges(activities, [nodes[0], nodes[1]])).toEqual([]);
  });
  it("renders file glyph motion only for an actual transferring edge", () => {
    const props = {
      id: "files:test",
      source: "host:a",
      target: "host:b",
      sourceX: 0,
      sourceY: 0,
      targetX: 100,
      targetY: 0,
      sourcePosition: "right",
      targetPosition: "left",
      data: { moving: true, phase: "transferring", count: 1 },
      style: { stroke: "var(--oria-color-primary)" },
    };
    const render = (moving: boolean) =>
      renderToStaticMarkup(
        <ReactFlowProvider>
          <svg>
            <FileTransferEdge
              {...(props as any)}
              data={{ ...props.data, moving }}
            />
          </svg>
        </ReactFlowProvider>,
      );
    expect(render(true)).toContain("animateMotion");
    expect(render(false)).not.toContain("animateMotion");
  });
});
