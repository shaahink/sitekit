import { describe, it, expect } from "vitest";
import { squash, basename, clamp } from "../src/widget/text.js";

describe("squash", () => {
  it("collapses whitespace and caps with an ellipsis", () => {
    expect(squash("  a \n b  ", 40)).toBe("a b");
    expect(squash("abcdefghij", 5)).toBe("abcd…");
  });

  it("treats nullish as empty", () => {
    expect(squash(null, 5)).toBe("");
    expect(squash(undefined, 5)).toBe("");
  });
});

describe("basename", () => {
  it("takes the last path segment, query stripped", () => {
    expect(basename("https://x.example/a/b/photo.jpg?w=400")).toBe("photo.jpg");
    expect(basename("photo.jpg")).toBe("photo.jpg");
    expect(basename("")).toBe("");
  });
});

describe("clamp", () => {
  it("clamps into the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});
