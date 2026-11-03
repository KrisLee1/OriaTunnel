import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import "@/i18n";
import { TransferItem } from "./transfer-item";
import type { Task } from "./api";
const task: Task = {
  id: "fixture",
  hostId: "fixture-host",
  hostName: "Loopback",
  sessionId: "fixture-session",
  direction: "download",
  sources: ["/home/fixture/url.txt"],
  target: "\\\\?\\D:\\",
  phase: "completed",
  bytes: 84,
  total: 84,
  count: 1,
  completed: ["/home/fixture/url.txt"],
  skipped: 0,
  revision: 2,
  error: null,
  conflict: null,
  temp: null,
  started: 1,
  finished: 2,
  speed: null,
  eta: null,
};
describe("transfer item information", () => {
  it("shows both SSH endpoints and selected direct transport without a local destination action", () => {
    const endpoint = (hostId:string) => ({hostId,hostName:hostId,sessionId:hostId,routeKey:hostId,route:[hostId]});
    const html=renderToStaticMarkup(<TransferItem task={{...task,direction:"relay",transport:"direct",sourceRemote:endpoint("Source"),targetRemote:endpoint("Destination"),target:"/dest",destination:"/dest/url.txt"}} onAction={()=>{}} />);
    expect(html).toContain("Source");expect(html).toContain("Destination");expect(html).toContain("/dest/url.txt");
    expect(html).toContain("files-transfer-mode");expect(html).not.toContain("files-transfer-target");
  });
  it("completed transfers hide empty speed/ETA and redundant progress, and display a normal Windows path", () => {
    const html = renderToStaticMarkup(
      <TransferItem task={task} onAction={() => {}} />,
    );
    expect(html).toContain("url.txt");
    expect(html).toContain("84 B");
    expect(html).toContain("D:\\");
    expect(html).not.toContain("\\\\?\\");
    expect(html).not.toContain('data-slot="progress"');
    expect(html).not.toContain("—");
    expect(html).toContain("lucide-trash-2");
  });
  it("running transfers retain measured progress and pause/cancel without a history-delete button", () => {
    const html = renderToStaticMarkup(
      <TransferItem
        task={{
          ...task,
          phase: "transferring",
          bytes: 42,
          speed: 21,
          eta: 2,
          finished: null,
        }}
        onAction={() => {}}
      />,
    );
    expect(html).toContain('data-slot="progress"');
    expect(html).toContain("21 B/s");
    expect(html).toContain("2s");
    expect(html).toContain("lucide-pause");
    expect(html).not.toContain("lucide-trash-2");
  });
});
