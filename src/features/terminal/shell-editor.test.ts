import { expect, it } from "vitest";
import {
  commandOutput,
  commandTranscript,
  completionWord,
  editorReply,
  editorRequest,
  environmentNames,
  exceedsPreviewHeight,
  insertCandidate,
  retainBlocks,
} from "./shell-editor";
it("copies a command block with its shell prompt and the original output spacing", () => {
  const block = { command: "echo hello", output: "\n  hello" };
  expect(commandTranscript(block, true)).toBe("> echo hello\n\n  hello");
  expect(commandTranscript(block)).toBe("$ echo hello\n\n  hello");
  expect(commandTranscript({ command: "", output: "banner" })).toBe("banner");
  expect(commandTranscript({ command: "pwd", output: "" })).toBe("$ pwd");
});
it("replaces only the path token, quotes shell metacharacters and keeps later arguments", () => {
  const line = 'cat "docs/a b" tail';
  const word = completionWord(line, 12);
  expect(word.prefix).toBe("docs/a b".slice(0, 7));
  expect(insertCandidate(line, word, "a $(pwd)").line).toBe(
    "cat docs/a\\ \\$\\(pwd\\) tail",
  );
  expect(completionWord(`cat "that's fine"`, 16).prefix).toContain("that's");
  expect(
    insertCandidate("cat t", completionWord("cat t", 5), "two\nlines").line,
  ).toBe("cat 'two\nlines'");
});
it("scopes replies to the SSH session and transports arbitrary UTF-8 as data", () => {
  const value = "文 '$()\n";
  const payload = editorRequest("cd", 2, value + "\0")
    .trim()
    .split(" ")
    .at(-1);
  expect(editorReply("abc;cwd;2;" + payload, "abc")?.fields).toEqual([value]);
  expect(editorReply("abc;cwd;2;" + payload, "another")).toBeUndefined();
});
it("completes PowerShell paths literally and preserves the rest of the line", () => {
  const line = "Get-ChildItem .\\child\\O -Force";
  const word = completionWord(line, line.indexOf(" -Force"), true);
  expect(word.prefix).toBe(".\\child\\O");
  expect(insertCandidate(line, word, "O'Brien $(dir)").line).toBe(
    "Get-ChildItem '.\\child\\O''Brien $(dir)' -Force",
  );
  expect(completionWord("Set-Location C:\\", 16, true).kind).toBe("dirs");
  expect(
    insertCandidate(".\\My", completionWord(".\\My", 4, true), "My Tool.exe")
      .line,
  ).toBe("& '.\\My Tool.exe'");
  expect(
    insertCandidate(
      "& .\\My",
      completionWord("& .\\My", 6, true),
      "My Tool.exe",
    ).line,
  ).toBe("& '.\\My Tool.exe'");
});
it("normalizes decorated and duplicate environment names", () => {
  expect(
    environmentNames([
      " (base) ",
      "base",
      " (demo) ",
      "demo",
      "",
      "\x1b[31mconda\x1b[0m",
    ]),
  ).toEqual(["demo", "conda"]);
});

it("copies only output, preserving repeated command-like lines and truncated scrollback", () => {
  expect(commandOutput("pwd", "$ pwd\n$ pwd\n/tmp")).toBe("$ pwd\n/tmp");
  expect(commandOutput("true", "$ true")).toBe("");
  expect(commandOutput("pwd", "  indented\n/tmp")).toBe("  indented\n/tmp");
});

it("keeps successive large output blocks and evicts whole older records at the transcript limit", () => {
  const block = {
    id: 0,
    command: "seq 5000",
    output: "line\n".repeat(4999) + "last",
    cwd: "/",
    home: "/",
  };
  let history = retainBlocks([], block);
  for (let id = 1; id <= 10; id++)
    history = retainBlocks(history, { ...block, id });
  expect(history.map((b) => b.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(history[0].outputLines).toBe(5000);
});

it("only offers an output preview above the smaller of 18 lines and 46% of the pane", () => {
  for (const [paneHeight, limit] of [
    [1200, 360],
    [500, 230],
  ]) {
    expect(exceedsPreviewHeight(limit - 1, paneHeight, 20)).toBe(false);
    expect(exceedsPreviewHeight(limit, paneHeight, 20)).toBe(false);
    expect(exceedsPreviewHeight(limit + 1, paneHeight, 20)).toBe(true);
  }
});
