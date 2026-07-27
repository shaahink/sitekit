import { describe, it, expect } from "vitest";
import { vercelJson, cloudflareHeaders, cloudflareRedirects } from "../src/headers/index.js";
import type { HostConfig } from "../src/headers/index.js";

/* Elfine's real config, in the neutral form. */
const ELFINE: HostConfig = {
  disableDeploymentsFor: ["feedback-assets"],
  headers: [
    {
      path: "/*",
      headers: {
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Frame-Options": "SAMEORIGIN",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
      }
    },
    { path: "/api/*", headers: { "Cache-Control": "no-store" } },
    { path: "/assets/*", headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=2592000" } },
    { path: "/favicon.svg", headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=2592000" } },
    { path: "/css/*", headers: { "Cache-Control": "public, max-age=0, must-revalidate" } },
    { path: "/js/*", headers: { "Cache-Control": "public, max-age=0, must-revalidate" } }
  ]
};

/* The file session 1 wrote by hand, byte for byte. If this test fails, the
   emitter is not ready to replace the hand-written files. */
const GOLDEN = `{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": {
    "deploymentEnabled": {
      "feedback-assets": false
    }
  },
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "X-Frame-Options", "value": "SAMEORIGIN" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" },
        { "key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains" }
      ]
    },
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "no-store" }
      ]
    },
    {
      "source": "/assets/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=86400, stale-while-revalidate=2592000" }
      ]
    },
    {
      "source": "/favicon.svg",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=86400, stale-while-revalidate=2592000" }
      ]
    },
    {
      "source": "/css/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }
      ]
    },
    {
      "source": "/js/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }
      ]
    }
  ]
}
`;

describe("vercelJson", () => {
  it("reproduces Elfine's hand-written vercel.json exactly", () => {
    expect(vercelJson(ELFINE)).toBe(GOLDEN);
  });

  it("omits the git block when no branch is silenced", () => {
    const text = vercelJson({ headers: [{ path: "/*", headers: { A: "b" } }] });
    expect(text).not.toContain('"git"');
    expect(JSON.parse(text)).toMatchObject({ headers: [{ source: "/(.*)" }] });
  });

  it("merges the vercel passthrough directly after $schema, byte for byte", () => {
    /* The splice the Astro sites carried in their own emit scripts — same
       keys, same order. If this shape drifts, their vercel.json files churn
       on the next regeneration. */
    const text = vercelJson({
      vercel: { framework: "astro", outputDirectory: "dist" },
      headers: [{ path: "/*", headers: { "X-Content-Type-Options": "nosniff" } }]
    });
    expect(text).toBe(`{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "astro",
  "outputDirectory": "dist",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" }
      ]
    }
  ]
}
`);
  });
});

describe("cloudflareHeaders", () => {
  it("emits the same rules in _headers form", () => {
    const text = cloudflareHeaders(ELFINE);
    expect(text).toContain("/*\n  X-Content-Type-Options: nosniff");
    expect(text).toContain("/api/*\n  Cache-Control: no-store");
    expect(text).toContain("/favicon.svg\n  Cache-Control: public, max-age=86400");
    expect(text.endsWith("\n")).toBe(true);
  });
});

describe("cloudflareRedirects", () => {
  it("emits from → to → status lines", () => {
    const text = cloudflareRedirects({
      headers: [],
      redirects: [
        { from: "/old", to: "/new", status: 301 },
        { from: "/tmp", to: "/next" }
      ]
    });
    expect(text).toBe("/old /new 301\n/tmp /next 302\n");
  });
});
