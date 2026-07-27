import { describe, it, expect, vi, afterEach } from "vitest";
import { safeEqual, sameHost, createThrottle } from "../src/feedback/guards.js";

describe("safeEqual", () => {
  it("accepts equal strings", () => {
    expect(safeEqual("curtain-call-2026", "curtain-call-2026")).toBe(true);
  });

  it("rejects unequal strings of the same length", () => {
    expect(safeEqual("curtain-call-2026", "curtain-call-2027")).toBe(false);
  });

  it("rejects different lengths without comparing", () => {
    expect(safeEqual("short", "much longer value")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });

  it("handles non-ASCII", () => {
    expect(safeEqual("clé-privée-été", "clé-privée-été")).toBe(true);
    expect(safeEqual("clé-privée-été", "clè-privée-été")).toBe(false);
  });
});

describe("sameHost", () => {
  it("accepts the site's own origin", () => {
    expect(sameHost("https://elfine-site.vercel.app", "elfine-site.vercel.app")).toBe(true);
  });

  it("rejects a mismatched origin", () => {
    expect(sameHost("https://evil.example", "elfine-site.vercel.app")).toBe(false);
  });

  it("rejects a malformed origin instead of throwing", () => {
    expect(sameHost("not an origin", "elfine-site.vercel.app")).toBe(false);
  });

  it("rejects when host is missing", () => {
    expect(sameHost("https://elfine-site.vercel.app", null)).toBe(false);
  });

  it("admits the configured extra origin, trailing slash forgiven", () => {
    expect(
      sameHost("https://preview.example.com", "elfine-site.vercel.app", "https://preview.example.com/")
    ).toBe(true);
  });
});

describe("createThrottle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets notes through under the limit", () => {
    const throttled = createThrottle({ max: 3, windowMs: 1000 });
    expect(throttled("ip")).toBe(false);
    expect(throttled("ip")).toBe(false);
    expect(throttled("ip")).toBe(false);
  });

  it("throttles past the limit", () => {
    const throttled = createThrottle({ max: 3, windowMs: 1000 });
    throttled("ip");
    throttled("ip");
    throttled("ip");
    expect(throttled("ip")).toBe(true);
  });

  it("forgets hits once the window passes", () => {
    vi.useFakeTimers();
    const throttled = createThrottle({ max: 1, windowMs: 1000 });
    throttled("ip");
    expect(throttled("ip")).toBe(true);
    vi.advanceTimersByTime(1001);
    expect(throttled("ip")).toBe(false);
  });

  it("sweeps the whole map above 500 tracked addresses", () => {
    const throttled = createThrottle({ max: 1, windowMs: 60_000 });
    throttled("first");
    expect(throttled("first")).toBe(true);
    /* 500 more addresses push the map past 500 entries, triggering the
       deliberate clear-all — after which "first" is fresh again. */
    for (let i = 0; i < 500; i++) throttled(`ip-${i}`);
    expect(throttled("first")).toBe(false);
  });
});
