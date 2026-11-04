export function parseDelimitedPreview(source: string, delimiter: "," | "\t") {
  if (!source.trim() || source.length > 200_000) return null;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"' && cell.length === 0) quoted = true;
    else if (character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (quoted) return null;
  row.push(cell.replace(/\r$/, ""));
  rows.push(row);
  const nonEmptyRows = rows.filter((candidate) =>
    candidate.some((value) => value.length > 0),
  );
  const width = nonEmptyRows[0]?.length || 0;
  if (
    nonEmptyRows.length < 2 ||
    width < 2 ||
    nonEmptyRows.some((candidate) => candidate.length !== width)
  ) {
    return null;
  }
  return nonEmptyRows;
}

export function isNumericText(value: string) {
  const normalized = value
    .trim()
    .replace(/[,%\s]/g, "")
    .replace(/^[¥$€£]/, "");
  return (
    normalized !== "" &&
    /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(normalized)
  );
}
