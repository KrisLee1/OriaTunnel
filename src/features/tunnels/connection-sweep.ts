// React Flow emits one cubic Bezier. Approximate its length numerically rather
// than forcing SVG layout with getTotalLength during every drag frame.
export function connectionSweep(path: string) {
  const points = (path.match(/-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) || []).map(
    Number,
  );
  let length = 0;
  if (points.length === 8 && points.every(Number.isFinite)) {
    let x = points[0],
      y = points[1];
    for (let step = 1; step <= 24; step++) {
      const t = step / 24,
        u = 1 - t;
      const nextX =
        u ** 3 * points[0] +
        3 * u ** 2 * t * points[2] +
        3 * u * t ** 2 * points[4] +
        t ** 3 * points[6];
      const nextY =
        u ** 3 * points[1] +
        3 * u ** 2 * t * points[3] +
        3 * u * t ** 2 * points[5] +
        t ** 3 * points[7];
      length += Math.hypot(nextX - x, nextY - y);
      x = nextX;
      y = nextY;
    }
  }
  length = Math.max(1, length);
  const band = Math.min(36, Math.max(14, length * 0.18));
  return {
    dasharray: `${band} ${length + band}`,
    frames: [
      { strokeDashoffset: `${band}px` },
      { strokeDashoffset: `${-(length + band)}px` },
    ],
  };
}
