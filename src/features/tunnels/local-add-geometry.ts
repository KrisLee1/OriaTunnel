export type Point = { x: number; y: number };
export type LocalAddAnchor = { origin: Point; normal: Point; near: boolean };

// Screen-pixel dimensions shared by the reveal geometry and the actual button.
export const LOCAL_ADD_RADIUS = 20;
export const LOCAL_ADD_GAP = 4;
export const LOCAL_ADD_OUTSIDE_REACH = LOCAL_ADD_RADIUS + LOCAL_ADD_GAP;
export const LOCAL_ADD_INSIDE_REACH = 4;
export const LOCAL_ADD_HIT_EXTENSION = LOCAL_ADD_GAP + LOCAL_ADD_INSIDE_REACH;

/** Coordinates are in canvas units; proximity and the detached gap use screen pixels. */
export function localAddAnchor(
  point: Point,
  width: number,
  height: number,
  zoom = 1,
): LocalAddAnchor {
  const clamp = (value: number, limit: number) =>
    Math.max(0, Math.min(limit, value));
  const candidates = [
    { origin: { x: 0, y: clamp(point.y, height) }, normal: { x: -1, y: 0 } },
    { origin: { x: width, y: clamp(point.y, height) }, normal: { x: 1, y: 0 } },
    { origin: { x: clamp(point.x, width), y: 0 }, normal: { x: 0, y: -1 } },
    { origin: { x: clamp(point.x, width), y: height }, normal: { x: 0, y: 1 } },
  ].map((anchor) => ({
    ...anchor,
    distance: Math.hypot(point.x - anchor.origin.x, point.y - anchor.origin.y),
  }));
  const nearest = candidates.reduce((a, b) =>
    a.distance <= b.distance ? a : b,
  );
  const inset = (value: number, limit: number) => {
    const margin = Math.min(32 / zoom, limit / 2);
    return Math.max(margin, Math.min(limit - margin, value));
  };
  const inside =
    point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height;
  const origin = nearest.normal.x
    ? { x: nearest.origin.x, y: inset(point.y, height) }
    : { x: inset(point.x, width), y: nearest.origin.y };
  const tangent = Math.abs(
    (point.x - origin.x) * nearest.normal.y -
      (point.y - origin.y) * nearest.normal.x,
  );
  return {
    origin,
    normal: nearest.normal,
    near:
      tangent <= LOCAL_ADD_RADIUS / zoom &&
      nearest.distance <=
        (inside ? LOCAL_ADD_INSIDE_REACH : LOCAL_ADD_OUTSIDE_REACH) / zoom,
  };
}

/** Keep the button reachable while the pointer crosses the space beside the card. */
export function inLocalAddCorridor(
  point: Point,
  anchor: LocalAddAnchor,
  zoom: number,
) {
  const dx = point.x - anchor.origin.x;
  const dy = point.y - anchor.origin.y;
  const outward = dx * anchor.normal.x + dy * anchor.normal.y;
  const tangent = Math.abs(dx * anchor.normal.y - dy * anchor.normal.x);
  return (
    outward >= -LOCAL_ADD_INSIDE_REACH / zoom &&
    outward <= (LOCAL_ADD_OUTSIDE_REACH + LOCAL_ADD_RADIUS + 4) / zoom &&
    tangent <= (LOCAL_ADD_RADIUS + 4) / zoom
  );
}
