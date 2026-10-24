import { describe, expect, it } from "vitest";
import { inLocalAddCorridor, localAddAnchor } from "./local-add-geometry";

describe("local card proximity action", () => {
  it("chooses the closest edge, keeps corners clear and excludes the card centre", () => {
    for (const [point, origin, normal] of [
      [
        { x: 196, y: 82 },
        { x: 200, y: 82 },
        { x: 1, y: 0 },
      ],
      [
        { x: -8, y: 82 },
        { x: 0, y: 82 },
        { x: -1, y: 0 },
      ],
      [
        { x: 100, y: 3 },
        { x: 100, y: 0 },
        { x: 0, y: -1 },
      ],
      [
        { x: 100, y: 169 },
        { x: 100, y: 164 },
        { x: 0, y: 1 },
      ],
    ]) {
      const anchor = localAddAnchor(point, 200, 164);
      expect(anchor).toMatchObject({ origin, normal, near: true });
    }
    expect(localAddAnchor({ x: 100, y: 82 }, 200, 164).near).toBe(false);
    expect(localAddAnchor({ x: 300, y: 82 }, 200, 164).near).toBe(false);
    expect(localAddAnchor({ x: 200, y: 1 }, 200, 164).origin).toEqual({
      x: 200,
      y: 32,
    });
  });
  it("uses the same physical proximity and reachability across canvas zooms", () => {
    for (const zoom of [0.2, 0.5, 1, 2]) {
      const anchor = localAddAnchor(
        { x: 200 + 20 / zoom, y: 82 },
        200,
        164,
        zoom,
      );
      expect(anchor.near).toBe(true);
      expect(
        localAddAnchor({ x: 200 + 28 / zoom, y: 82 }, 200, 164, zoom).near,
      ).toBe(false);
      expect(
        inLocalAddCorridor({ x: 200 + 34 / zoom, y: 82 }, anchor, zoom),
      ).toBe(true);
      expect(
        inLocalAddCorridor({ x: 200 + 60 / zoom, y: 82 }, anchor, zoom),
      ).toBe(true);
      expect(
        inLocalAddCorridor({ x: 200 + 64 / zoom, y: 82 }, anchor, zoom),
      ).toBe(false);
      expect(
        inLocalAddCorridor(
          { x: 200 + 34 / zoom, y: 82 + 30 / zoom },
          anchor,
          zoom,
        ),
      ).toBe(false);
      expect(localAddAnchor({ x: 100, y: 82 }, 200, 164, zoom).near).toBe(
        false,
      );
    }
  });
});
