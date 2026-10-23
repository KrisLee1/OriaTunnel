type Shortcut = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "shiftKey" | "metaKey" | "altKey"
>;

export function isWebviewDebugShortcut(event: Shortcut) {
  const key = event.key.toLowerCase();
  return (
    key === "f12" ||
    key === "contextmenu" ||
    (event.shiftKey && key === "f10") ||
    (((event.ctrlKey && event.shiftKey) || (event.metaKey && event.altKey)) &&
      ["i", "j", "c"].includes(key)) ||
    (event.ctrlKey && !event.altKey && !event.shiftKey && key === "u") ||
    (event.metaKey && event.altKey && key === "u")
  );
}

// Native release builds also disable DevTools in Rust. This blocks browser menus
// and their keyboard entry points without changing ordinary editing shortcuts.
export function installWebviewGuards(target: Document, production: boolean) {
  if (!production) return () => {};
  const options = { capture: true };
  const contextMenu = (event: MouseEvent) => event.preventDefault();
  const keyDown = (event: KeyboardEvent) => {
    if (isWebviewDebugShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  target.addEventListener("contextmenu", contextMenu, options);
  target.addEventListener("keydown", keyDown, options);
  return () => {
    target.removeEventListener("contextmenu", contextMenu, options);
    target.removeEventListener("keydown", keyDown, options);
  };
}
