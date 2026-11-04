import "@/i18n";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TransferDetails } from "./transfer-details";
import {
  FileTransferDetailsContext,
  projectFileActivities,
} from "./transfer-state";
import { projectFileEdges } from "./transfer-graph";
import type { Task } from "./api";

const task: Task = {
  id: "one",
  hostId: "host",
  hostName: "Fixture SSH",
  sessionId: "session",
  direction: "download",
  sources: ["/data/报告.txt"],
  target: "\\\\?\\D:\\目标",
  destination: "\\\\?\\D:\\目标\\报告.txt",
  phase: "transferring",
  bytes: 42,
  total: 84,
  speed: 21,
  eta: 2,
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
const render = (tasks: Task[], ids = ["one"]) =>
  renderToStaticMarkup(
    <FileTransferDetailsContext.Provider value={tasks}>
      <TransferDetails taskIds={ids} />
    </FileTransferDetailsContext.Provider>,
  );

describe("file edge hover information", () => {
  it("shows only the selected edge's tasks with direction, normalized destination and actual progress", () => {
    const html = render([
      task,
      { ...task, id: "unrelated", hostName: "Other SSH" },
    ]);
    for (const value of [
      "报告.txt",
      "Fixture SSH",
      "此电脑",
      "D:\\目标\\报告.txt",
      "42 B / 84 B",
      "21 B/s",
      "2s",
      'data-slot="progress"',
    ])
      expect(html).toContain(value);
    expect(html).not.toContain("\\\\?\\");
    expect(html).not.toContain("Other SSH");
  });
  it("refreshes hover metrics without changing activity or edge references and stops speed on pause", () => {
    const activities = projectFileActivities([task]);
    const nodes = [
      { id: "local", position: { x: 0, y: 0 } },
      { id: "host:host", position: { x: 400, y: 0 } },
    ];
    const edges = projectFileEdges(activities, nodes);
    const updated = { ...task, bytes: 63, speed: 42, revision: 2 };
    const next = projectFileActivities([updated], activities);
    expect(next).toBe(activities);
    expect(projectFileEdges(next, nodes, edges)).toBe(edges);
    expect(render([updated])).toContain("63 B / 84 B");
    expect(render([{ ...updated, phase: "paused" }])).not.toContain("42 B/s");
  });
  it("bounds displayed tasks while retaining the total and remaining count", () => {
    const tasks = Array.from({ length: 8 }, (_, index) => ({
      ...task,
      id: `task-${index}`,
      sources: [`/file-${index}.txt`],
    }));
    const html = render(
      tasks,
      tasks.map((task) => task.id),
    );
    expect(html).toContain("传输：8");
    expect(html).toContain("另有 5 项传输");
    expect(html.match(/class="files-edge-detail"/g)).toHaveLength(3);
  });
});
