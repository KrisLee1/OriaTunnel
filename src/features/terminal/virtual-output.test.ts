import { describe, expect, it } from "vitest";
import { indexOutput } from "./virtual-output";

describe("virtual terminal pages", () => {
  it("preserves blank lines, surrogate pairs and ANSI runs crossing page boundaries", () => {
    const text = "a".repeat(8191) + "😀中" + "\n".repeat(70) + "end";
    const runs = [{ start: 8170, end: 8200, style: { fontWeight: 700 } }];
    const pages = indexOutput(text, runs);
    expect(pages.map((page) => text.slice(page.start, page.end)).join("")).toBe(
      text,
    );
    expect(text.slice(pages[1].start, pages[1].start + 2)).toBe("😀");
    expect(pages[1].firstRun).toBe(0);
    expect(pages.at(-1)?.firstRun).toBe(1);
  });
});
