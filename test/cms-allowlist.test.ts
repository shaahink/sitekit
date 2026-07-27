import { describe, it, expect } from "vitest";
import { allows } from "../src/cms/allowlist.js";

const bruce = { sub: "108134", email: "Bruce.Nemeth@Example.com" };

describe("allows", () => {
  it("matches an email however it was capitalised", () => {
    expect(allows("bruce.nemeth@example.com", bruce)).toBe(true);
    expect(allows("BRUCE.NEMETH@EXAMPLE.COM", bruce)).toBe(true);
  });

  it("matches the durable Google sub, so an email change doesn't lock someone out", () => {
    expect(allows("108134", bruce)).toBe(true);
  });

  it("picks one out of a list, spaces and all", () => {
    expect(allows("azarnoosh@example.com, bruce.nemeth@example.com , elfine@example.com", bruce))
      .toBe(true);
  });

  it("admits nobody when the allowlist is unset or empty", () => {
    /* A half-configured site must not be an open door. */
    expect(allows(undefined, bruce)).toBe(false);
    expect(allows("", bruce)).toBe(false);
    expect(allows("  ,  ", bruce)).toBe(false);
  });

  it("does not match a different account", () => {
    expect(allows("someone@example.com", bruce)).toBe(false);
  });

  it("does not match on a substring", () => {
    expect(allows("nemeth@example.com", bruce)).toBe(false);
    expect(allows("10813", bruce)).toBe(false);
  });
});
