type FileKey = Pick<
  KeyboardEvent,
  | "key"
  | "metaKey"
  | "ctrlKey"
  | "altKey"
  | "shiftKey"
  | "isComposing"
  | "defaultPrevented"
>;

// Only the focused file grid handles these actions; inputs and menus retain
// their native keys. Mac Return renames, while Command+Down opens the selection.
export function fileShortcut(event: FileKey, mac: boolean) {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    event.shiftKey
  )
    return;
  const key = event.key.toLowerCase();
  const command = mac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  if (command) {
    if (key === "a") return "selectAll";
    if (key === "c") return "copyPath";
    if (mac && key === "backspace") return "delete";
    if (mac && key === "arrowdown") return "open";
    if (mac && key === "arrowup") return "parent";
    return;
  }
  if (event.metaKey || event.ctrlKey) return;
  if (key === "enter") return mac ? "rename" : "open";
  if (key === "f2") return "rename";
  if (!mac && key === "delete") return "delete";
  if (key === " ") return "open";
}
