import { describe, it, expect } from "vitest";
import { umamiOrigin, umamiScriptTag, umamiTag } from "../src/analytics/index.js";

const STATS = {
  src: "https://sk-stats.vercel.app/script.js",
  websiteId: "0193e9a1-aaaa-bbbb-cccc-1234567890ab"
};

describe("umamiTag", () => {
  it("emits the deferred external tracker attributes", () => {
    expect(umamiTag(STATS)).toEqual({
      defer: true,
      src: "https://sk-stats.vercel.app/script.js",
      "data-website-id": "0193e9a1-aaaa-bbbb-cccc-1234567890ab"
    });
  });
});

describe("umamiScriptTag", () => {
  it("emits the same tag as markup", () => {
    expect(umamiScriptTag(STATS)).toBe(
      '<script defer src="https://sk-stats.vercel.app/script.js" data-website-id="0193e9a1-aaaa-bbbb-cccc-1234567890ab"></script>'
    );
  });

  it("escapes what it interpolates", () => {
    const html = umamiScriptTag({ ...STATS, websiteId: 'x" onload="alert(1)' });
    expect(html).toContain('data-website-id="x&quot; onload=&quot;alert(1)"');
  });
});

describe("umamiOrigin", () => {
  it("is the origin CSP must allow for script-src and connect-src", () => {
    expect(umamiOrigin(STATS.src)).toBe("https://sk-stats.vercel.app");
  });
});
