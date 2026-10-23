export function bytes(value?: number | null) {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB"];
  let n = value;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit++;
  }
  if (Number(n.toFixed(unit ? 1 : 0)) >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit++;
  }
  return `${n.toFixed(unit || (n > 0 && n < 1) ? 1 : 0)} ${units[unit]}`;
}

export function rate(value?: number | null) {
  const formatted = bytes(value);
  return formatted === "—" ? formatted : `${formatted}/s`;
}

export function duration(
  value?: number | null,
  units: readonly string[] = ["d", "h", "m", "s"],
) {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  let remaining = Math.floor(value);
  const parts: string[] = [];
  [86400, 3600, 60, 1].forEach((size, index) => {
    const amount = Math.floor(remaining / size);
    remaining %= size;
    if (amount) parts.push(`${amount}${units[index]}`);
  });
  return parts.join(" ") || `0${units[3]}`;
}
