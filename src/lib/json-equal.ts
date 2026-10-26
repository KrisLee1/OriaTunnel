// IPC values are JSON trees. Compare without allocating serialized copies, and
// stop at the first changed field (before large metric histories when possible).
export function equalJsonValue(before: unknown, next: unknown): boolean {
  if (before === next) return true;
  if (
    !before ||
    !next ||
    typeof before !== "object" ||
    typeof next !== "object"
  )
    return false;
  if (Array.isArray(before))
    return (
      Array.isArray(next) &&
      before.length === next.length &&
      before.every((value, index) => equalJsonValue(value, next[index]))
    );
  if (Array.isArray(next)) return false;
  const a = before as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equalJsonValue(a[key], b[key]))
  );
}
