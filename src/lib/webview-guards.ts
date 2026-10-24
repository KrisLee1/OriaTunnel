import {
  terminalEditingShortcut,
  terminalShortcutAction,
} from "@/features/terminal/terminal-model";
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
// and their keyboard entry points without changing editing or the terminal's app menu shortcuts.
export function installWebviewGuards(target: Document, production: boolean) {
  if (!production) return () => {};
  const options = { capture: true };
  const contextMenu = (event: MouseEvent) => event.preventDefault();
  const keyDown = (event: KeyboardEvent) => {
    if (
      typeof Element !== "undefined" &&
      event.target instanceof Element &&
      event.target.closest("[data-ssh-terminal]") &&
      terminalEditingShortcut(event)
    )
      return;
    if (
      typeof Element !== "undefined" &&
      event.target instanceof Element &&
      event.target.closest("[data-ssh-terminal-menu]") &&
      terminalShortcutAction(event)
    )
      return;
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
