// The PTY carries both ordinary output and private OSC replies scoped to one session.
export function editorRequest(action: string, sequence: number, value = "") {
  let bytes = "";
  for (const byte of new TextEncoder().encode(value))
    bytes += String.fromCharCode(byte);
  return `#oria ${action} ${sequence} ${btoa(bytes)}\n`;
}

export function editorReply(data: string, sessionId: string) {
  const [id, kind, revision, payload] = data.split(";");
  if (
    id !== sessionId ||
    !kind ||
    !/^\d+$/.test(revision) ||
    payload === undefined ||
    payload.length > 1024 * 1024
  )
    return;
  try {
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    const fields = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .split("\0");
    fields.pop();
    return { kind, revision: Number(revision), fields };
  } catch {
    return;
  }
}

export function environmentNames(fields: string[]) {
  return [
    ...new Set(
      fields
        .map((field) =>
          field
            .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "")
            .replace(/[\x00-\x1f\x7f]/gu, "")
            .trim()
            .replace(/^\((.*)\)$/u, "$1")
            .trim(),
        )
        .filter((name) => name && name !== "base"),
    ),
  ];
}
export type ShellQuery = (
  operation: string,
  value: string,
) => Promise<string[]>;

export type Prompt = { cwd: string; home: string; environments?: string[] };
export type CommandBlock = Prompt & {
  id: number;
  command: string;
  output: string;
  runs?: import("./terminal-output").OutputRun[];
};
export type ArchivedBlock = CommandBlock & { outputLines: number };
export type TerminalCopyText = { command: string; output: string };
// The PTY screen includes the native prompt and submitted command.
export function commandOutput(command: string, screen: string) {
  if (!command) return screen;
  const echo = "$ " + command;
  return screen === echo
    ? ""
    : screen.startsWith(echo + "\n")
      ? screen.slice(echo.length + 1)
      : screen;
}
// CSS applies min(18lh, 46cqh) to the preview's border box.
export function exceedsPreviewHeight(
  height: number,
  paneHeight: number,
  lineHeight: number,
) {
  return height > Math.round(Math.min(18 * lineHeight, paneHeight * 0.46));
}

// The PTY retains 5,000 physical rows per command. Budget the transcript
// separately so the next long command can coexist with earlier previews.
export function retainBlocks(blocks: ArchivedBlock[], block: CommandBlock) {
  let outputLines = 1;
  for (
    let at = block.output.indexOf("\n");
    at >= 0;
    at = block.output.indexOf("\n", at + 1)
  )
    outputLines++;
  const result: ArchivedBlock[] = [{ ...block, outputLines }];
  let characters = block.output.length + block.command.length;
  let lines = outputLines;
  let styles = block.runs?.length ?? 0;
  for (let i = blocks.length - 1; i >= 0 && result.length < 500; i--) {
    const previous = blocks[i];
    characters += previous.output.length + previous.command.length;
    lines += previous.outputLines;
    styles += previous.runs?.length ?? 0;
    if (characters > 2_000_000 || lines > 50_000 || styles > 65_536) break;
    result.push(previous);
  }
  return result.reverse();
}

const boundary = /[\s|;&()<>]/u;
export function completionWord(line: string, cursor: number) {
  let start = 0,
    quote = "",
    escaped = false;
  const spans: Array<[number, number]> = [];
  for (let i = 0; i <= line.length; i++) {
    const c = line[i];
    if (!c || (!escaped && !quote && boundary.test(c))) {
      if (i > start) spans.push([start, i]);
      start = i + 1;
    } else if (escaped) escaped = false;
    else if (c === "\\" && quote !== "'") escaped = true;
    else if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
  }
  const [from, to] = spans.find(([a, b]) => cursor >= a && cursor <= b) || [
    cursor,
    cursor,
  ];
  const before = line.slice(0, from);
  let prefix = "";
  quote = "";
  const typed = line.slice(from, cursor);
  for (let i = 0; i < typed.length; i++) {
    const c = typed[i],
      next = typed[i + 1];
    if (!quote && (c === "'" || c === '"')) quote = c;
    else if (quote && c === quote) quote = "";
    else if (
      c === "\\" &&
      next &&
      (!quote || (quote === '"' && /["$`\\\n]/u.test(next)))
    ) {
      prefix += next;
      i++;
    } else prefix += c;
  }
  const command = !before.trim() || /[|;&(]\s*$/u.test(before);
  const kind =
    command && !prefix.includes("/")
      ? "commands"
      : /(?:^|[|;&])\s*(?:builtin\s+)?cd\s+$/u.test(before)
        ? "dirs"
        : "files";
  return { from, to, prefix, kind };
}

export function insertCandidate(
  line: string,
  word: ReturnType<typeof completionWord>,
  name: string,
) {
  const slash = word.kind === "commands" ? -1 : word.prefix.lastIndexOf("/");
  const value = word.prefix.slice(0, slash + 1) + name;
  const escaped = /[\n\r]/u.test(value)
    ? "'" + value.replaceAll("'", "'\\''") + "'"
    : value
        .replace(/[^\p{L}\p{N}\-_.~/:]/gu, (c) => "\\" + c)
        .replace(
          /^~/u,
          slash >= 0 && word.prefix.startsWith("~/") ? "~" : "\\~",
        );
  return {
    line: line.slice(0, word.from) + escaped + line.slice(word.to),
    cursor: word.from + escaped.length,
  };
}
