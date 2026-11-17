import { expect, it } from "vitest";
import { commandKeywords, matchingCommands } from "./saved-command-model";

it("preserves phrases and deduplicates full-width, mixed-case and Chinese tags", () => {
  expect(
    commandKeywords(" 创建账户，ＥＶＯＸ 环境、evox 环境, 创建账户"),
  ).toEqual(["创建账户", "ＥＶＯＸ 环境"]);
});
it("ranks exact, prefix and substring keyword matches and preserves ties", () => {
  const entries = ["use evox", "EVOX环境", "evox", "evox local", "其他"].map(
    (keyword, i) => ({
      id: String(i),
      keywords: [keyword],
      command: "echo " + i,
    }),
  );
  expect(
    matchingCommands(entries, "ＥＶＯＸ").map((entry) => entry.id),
  ).toEqual(["2", "1", "3", "0"]);
  expect(matchingCommands(entries, " ")).toEqual([]);
});
