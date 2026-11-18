import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "@/i18n";
import { TransferItem } from "./transfer-item";
import { TransferBatchDetails } from "./transfer-batch-details";
import { TransferQueue } from "./transfer-queue";
import { TransferDetails } from "./transfer-details";
import { FileTransferDetailsContext } from "./transfer-state";
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
  it("shows live scan evidence in both row widths without a premature total or percentage", () => {
    const html = renderToStaticMarkup(
      <TransferItem task={{ ...task, phase: "preparing", scan: { items: 250001, bytes: 60 * 1024 ** 3, directory: "/folder/nested" } }} onAction={() => {}} />,
    );
    expect(html).toContain("已扫描 250,001 项 · 60.0 GiB");
    expect(html).toContain('aria-hidden="true">已扫描 250,001 项');
    expect(html).toContain("/folder/nested");
    expect(html).toContain('aria-valuenow="0"');
  });
  it("keeps clear unavailable until recovery and remote process checks are settled", () => {
    const label = (key: string) => 'aria-label="' + i18n.t(key, { ns: "files" }) + '"';
    const row = (changes: Partial<Task>) => renderToStaticMarkup(
      <TransferItem task={{ ...task, ...changes }} onAction={() => {}} />,
    );
    expect(row({ phase: "failed" })).toContain(label("clear"));
    for (const pending of [
      { directPending: true },
      { commitTarget: "/dest" },
      { error: "commitUnknown" },
    ]) {
      expect(row({ phase: "failed", ...pending })).not.toContain(label("clear"));
    }
    expect(row({ phase: "cancelled", directPending: true })).toContain(label("verifyDirect"));
  });
  it("shares one source-to-target path row with single transfers and keeps the local source actionable", () => {
    const download = renderToStaticMarkup(
      <TransferItem task={task} onAction={() => {}} />,
    );
    expect(download).toContain('class="files-transfer-paths"');
    expect(download).toContain("Loopback · /home/fixture/url.txt");
    expect(download).toContain("此电脑 · D:\\url.txt");
    expect(download).toContain('aria-label="源路径"');
    expect(download).toContain('aria-label="目标路径"');
    const upload = renderToStaticMarkup(
      <TransferItem
        task={{
          ...task,
          direction: "upload",
          sources: ["C:\\source\\a.txt"],
          target: "/dest",
          destination: "/dest/a.txt",
        }}
        onAction={() => {}}
      />,
    );
    expect(upload).toContain(
      "源路径 · 打开所在文件夹 · 此电脑 · C:\\source\\a.txt",
    );
    expect(upload).toContain("Loopback · /dest/a.txt");
    expect(upload).not.toContain("files-transfer-route");
  });
  it("shows the batch target directory and labels transferred bytes separately from the selected total", () => {
    const html = renderToStaticMarkup(
      <TransferItem
        task={{
          ...task,
          sources: ["/a", "/b"],
          target: "D:\\Downloads",
          destination: "D:\\wrong\\last.txt",
          phase: "partial",
          bytes: 1024,
          total: 1024,
          sourceDetails: {
            "/a": { destination: "D:\\Downloads\\a", size: 1024 },
            "/b": { destination: "D:\\Downloads\\b", size: 2048 },
          },
        }}
        onAction={() => {}}
      />,
    );
    expect(html).toContain("此电脑 · D:\\Downloads");
    expect(html).not.toContain("D:\\wrong");
    expect(html).toContain("已传输");
    expect(html).toContain("1.0 KiB");
    expect(html).toContain("总大小");
    expect(html).toContain("3.0 KiB");
  });
  it("renders both paths and real sizes with folder actions only for the local endpoint", () => {
    const value = {
      ...task,
      sources: ["/a.txt", "/b.txt"],
      sourceDetails: {
        "/a.txt": { destination: "\\\\?\\D:\\Downloads\\a (2).txt", size: 64 },
        "/b.txt": { destination: "D:\\Downloads\\b.txt", size: 0 },
      },
    };
    const html = renderToStaticMarkup(
      <TransferBatchDetails task={value} onOpenFolder={() => {}} />,
    );
    expect(html).toContain("源路径");
    expect(html).toContain("目标路径");
    expect(html).toContain("Loopback · /a.txt");
    expect(html).toContain("此电脑 · D:\\Downloads\\a (2).txt");
    expect(html).toContain("64 B");
    expect(html).toContain("0 B");
    expect(html).not.toContain("\\\\?\\");
    expect((html.match(/<button /g) || []).length).toBe(2);
    const upload = renderToStaticMarkup(
      <TransferBatchDetails
        task={{ ...value, direction: "upload" }}
        onOpenFolder={() => {}}
      />,
    );
    expect((upload.match(/<button /g) || []).length).toBe(2);
    expect(upload).toContain("打开所在文件夹 · 此电脑 · /a.txt");
  });
  it("defaults to transfer-type groups with independent time/group controls and no current-host button", () => {
    const html = renderToStaticMarkup(
      <TransferQueue
        tasks={[
          task,
          { ...task, id: "new", direction: "upload", started: Date.now() },
        ]}
        expanded
        onToggle={() => {}}
        onAction={() => {}}
        onClear={() => {}}
      />,
    );
    expect(html).toContain('title="分组 · 按传输类型"');
    expect(html).toContain('aria-label="时间排序"');
    expect(html).toContain('aria-label="分组"');
    expect(html).not.toContain("当前主机");
    expect(html.indexOf('data-transfer-task="new"')).toBeLessThan(
      html.indexOf('data-transfer-task="fixture"'),
    );
    expect(html).not.toContain("files-time-heading");
    expect((html.match(/files-transfer-group-heading/g) || []).length).toBe(2);
  });
  it("keeps a long queue windowed while counting every task and offering the next page", () => {
    const tasks = Array.from({ length: 205 }, (_, i) => ({
      ...task,
      id: `history-${i}`,
      started: i,
    }));
    const html = renderToStaticMarkup(
      <TransferQueue
        tasks={tasks}
        expanded
        onToggle={() => {}}
        onAction={() => {}}
        onClear={() => {}}
      />,
    );
    expect(html).toContain('data-transfer-task="history-204"');
    expect(html).toContain("<small>200</small>");
    expect(html).toContain("205");
    expect(html.match(/data-transfer-task=/g)!.length).toBeLessThan(20);
    expect(html).toContain(i18n.t("loadMoreTasks", { ns: "files" }));
  });
  it("collapsing the queue removes records and display controls without hiding history cleanup", () => {
    const html = renderToStaticMarkup(
      <TransferQueue
        tasks={[task]}
        expanded={false}
        onToggle={() => {}}
        onAction={() => {}}
        onClear={() => {}}
      />,
    );
    expect(html).toContain("清空已结束记录");
    expect(html).not.toContain("data-transfer-task");
    expect(html).not.toContain('aria-label="时间排序"');
  });
  it("keeps the horizontal queue accessible as a vertical rail when collapsed", () => {
    const html = renderToStaticMarkup(
      <TransferQueue
        tasks={[task]}
        expanded={false}
        orientation="horizontal"
        onToggle={() => {}}
        onAction={() => {}}
        onClear={() => {}}
      />,
    );
    expect(html).toContain("files-queue-rail");
    expect(html).toContain('aria-label="传输列表"');
    expect(html).toContain("清空已结束记录");
    expect(html).not.toContain("data-transfer-task");
  });
  it("keeps multi-selection in one collapsed task and mounts no file details until expanded", () => {
    const html = renderToStaticMarkup(
      <TransferItem
        task={{ ...task, sources: ["/a.txt", "/b.txt"] }}
        onAction={() => {}}
      />,
    );
    expect(html).toContain('data-slot="collapsible-trigger"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("批量传输");
    expect(html).not.toContain("data-batch-source");
    expect((html.match(/data-transfer-task=/g) || []).length).toBe(1);
  });
  it("bounds the initial batch detail DOM even for a thousand selected roots", () => {
    const sources = Array.from({ length: 1000 }, (_, i) => `/file-${i}.txt`);
    const html = renderToStaticMarkup(
      <TransferBatchDetails task={{ ...task, sources }} />,
    );
    const rendered = (html.match(/data-batch-source=/g) || []).length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(30);
    expect(html).toContain("file-0.txt");
    expect(html).not.toContain("file-999.txt");
  });
  it("shows both SSH endpoints and selected direct transport without a local destination action", () => {
    const endpoint = (hostId: string) => ({
      hostId,
      hostName: hostId,
      sessionId: hostId,
      routeKey: hostId,
      route: [hostId],
    });
    const html = renderToStaticMarkup(
      <TransferItem
        task={{
          ...task,
          direction: "relay",
          transport: "direct",
          sourceRemote: endpoint("Source"),
          targetRemote: endpoint("Destination"),
          target: "/dest",
          destination: "/dest/url.txt",
        }}
        onAction={() => {}}
      />,
    );
    expect(html).toContain("Source");
    expect(html).toContain("Destination");
    expect(html).toContain("/dest/url.txt");
    expect(html).toContain("files-transfer-mode");
    expect(html).not.toContain("files-transfer-target");
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
          eta: 3661,
          elapsedMs: 65000,
          finished: null,
        }}
        onAction={() => {}}
      />,
    );
    expect(html).toContain('data-slot="progress"');
    expect(html).toContain("21 B/s");
    expect(html).toContain("<dt>预计剩余</dt><dd>1小时 1分 1秒</dd>");
    expect(html).toContain("<dt>已用时间</dt><dd>1分 5秒</dd>");
    expect(html).toContain("lucide-pause");
    expect(html).not.toContain("lucide-trash-2");
  });
  it("formats measured durations and a stalled rate in the connection edge hover card", () => {
    const entry = { ...task, phase: "transferring", finished: null, speed: 0, eta: 90061, elapsedMs: 59000 };
    const html = renderToStaticMarkup(<FileTransferDetailsContext.Provider value={[entry]}>
      <TransferDetails taskIds={[entry.id]} />
    </FileTransferDetailsContext.Provider>);
    expect(html).toContain("1天 1小时 1分 1秒");
    expect(html).toContain("59秒");
    expect(html).toContain("0 B/s");
  });
});
