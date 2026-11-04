import { displayPath } from "./api";
const KEY = "oria-tunnel.files-local-directory.v1";
export function readLocalDirectory() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "null");
    return typeof value === "string" &&
      value.length <= 32768 &&
      !/[\u0000-\u001f]/.test(value)
      ? displayPath(value)
      : "";
  } catch {
    return "";
  }
}
export function saveLocalDirectory(path: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(displayPath(path)));
  } catch {
    /* Optional local navigation preference. */
  }
}
