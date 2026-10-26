import { describe, expect, it } from "vitest";
import { equalJsonValue } from "./json-equal";

describe("IPC JSON equality", () => {
  it("compares nested values independently of object property order", () => {
    expect(
      equalJsonValue(
        { a: [1, null, { b: false }], c: "x" },
        { c: "x", a: [1, null, { b: false }] },
      ),
    ).toBe(true);
    expect(equalJsonValue({ a: 1 }, { b: 1 })).toBe(false);
    expect(equalJsonValue({ a: null }, {})).toBe(false);
    expect(equalJsonValue([1, 2], [2, 1])).toBe(false);
    expect(equalJsonValue([], {})).toBe(false);
    expect(equalJsonValue({ a: [1] }, { a: [1, 2] })).toBe(false);
    expect(equalJsonValue({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });
});
