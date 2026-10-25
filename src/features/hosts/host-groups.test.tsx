import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { groupHosts, HostGroups } from "./host-groups";
import { emptyHost } from "@/features/tunnels/rule-model";
import type { Runtime } from "@/types";
describe("host grouping", () => {
  const hosts = [
    { ...emptyHost(), id: "a", name: "A", tags: ["prod", "prod", "team"] },
    { ...emptyHost(), id: "b", name: "B", tags: [], source: "config" },
  ];
  it("keeps untagged hosts and multi-tag membership without duplicate entries within a group", () => {
    const grouped = Object.fromEntries(groupHosts(hosts, "tags"));
    expect(grouped.prod.map((h) => h.id)).toEqual(["a"]);
    expect(grouped.team.map((h) => h.id)).toEqual(["a"]);
    expect(grouped[""].map((h) => h.id)).toEqual(["b"]);
    expect(groupHosts(hosts, "none")[0][1]).toHaveLength(2);
    expect(groupHosts(hosts, "auth")).toHaveLength(1);
    const auth = Object.fromEntries(
      groupHosts([{ ...hosts[0], authMethod: "password" }, hosts[1]], "auth"),
    );
    expect(auth.password.map((host) => host.id)).toEqual(["a"]);
    expect(auth.auto.map((host) => host.id)).toEqual(["b"]);
  });
  it("renders collapsible labeled groups and retains selection with escaped untrusted names", () => {
    const html = renderToStaticMarkup(
      <HostGroups
        hosts={[{ ...hosts[0], name: "<unsafe>" }]}
        runtimes={[]}
        grouping="tags"
        selected="a"
        actions={() => null}
      />,
    );
    expect(html).toContain("<details");
    expect(html).toContain("<summary>prod");
    expect(html).toContain("selected");
    expect(html).toContain("&lt;unsafe&gt;");
    expect(html).not.toContain("<unsafe>");
  });
  it("places the authoritative status after the name and keeps row actions separate from details", () => {
    const runtime: Runtime = {
      ruleId: "host-test:a",
      runId: "test",
      status: "tested",
      message: "",
      sent: 0,
      received: 0,
      connections: 0,
      configurationChanged: false,
      desiredRunning: false,
      retryCount: 0,
      uptimeSecs: 0,
      targetHealth: {},
      history: [],
    };
    const html = renderToStaticMarkup(
      <HostGroups
        hosts={[hosts[0]]}
        runtimes={[runtime]}
        grouping="none"
        actions={(host, current) => {
          expect(host.id).toBe("a");
          expect(current).toBe(runtime);
          return (
            <>
              <button aria-haspopup="dialog">details</button>
              <button>edit</button>
              <button>delete</button>
              <button>test</button>
            </>
          );
        }}
      />,
    );
    expect(html).toMatch(
      /<strong[^>]*>A<\/strong><span class="status tone-success"/,
    );
    expect(html).toContain('class="host-item-actions"');
    expect(html.match(/<button /g)).toHaveLength(1);
    expect(html.match(/<button>/g)).toHaveLength(3);
    expect(html).not.toContain('role="region"');
    expect(html).not.toContain("aria-expanded=");
    const untested = renderToStaticMarkup(
      <HostGroups
        hosts={[hosts[0]]}
        runtimes={[]}
        grouping="none"
        actions={() => null}
      />,
    );
    expect(untested).toContain('class="status tone-neutral"');
    expect(untested).not.toContain("tone-success");
  });
});
