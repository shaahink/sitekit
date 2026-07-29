import { describe, it, expect } from "vitest";
import {
  vercelJson,
  cloudflareHeaders,
  cloudflareMiddleware,
  cloudflareRedirects
} from "../src/headers/index.js";
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

/* Session 9.5 Task 3 finding 7, as a config. The first rule is shade's real
   one and correct on both hosts; the second is the one that emits cleanly for
   Cloudflare and wrongly for Vercel. */
const WILDCARD: HostConfig = {
  headers: [{ path: "/*", headers: { "X-Content-Type-Options": "nosniff" } }],
  redirects: [
    { from: "/about.html", to: "/", status: 301 },
    { from: "/old/*", to: "/new/:splat" }
  ]
};

describe("vercelJson on a redirect it cannot translate", () => {
  it("refuses, naming the offending rule", () => {
    /* Naming it is the whole requirement: a config can carry several redirects
       and "cannot translate a redirect" would send someone reading all of
       them. The rule that is wrong is quoted in the form it was written in. */
    expect(() => vercelJson(WILDCARD)).toThrowError(/"\/old\/\* → \/new\/:splat"/);
    expect(() => vercelJson(WILDCARD)).toThrowError(/":splat"/);
    /* And it says what Vercel would have been handed, since that is the thing
       nobody can see from the config. */
    expect(() => vercelJson(WILDCARD)).toThrowError(/\/old\/\(\.\*\)/);
  });

  it("still emits the same config for Cloudflare, which is right there", () => {
    /* The refusal is about one host's spelling, not a ban on wildcards. If this
       ever throws too, the fix went in the wrong place. */
    expect(cloudflareRedirects(WILDCARD)).toBe("/about.html / 301\n/old/* /new/:splat 302\n");
  });

  it("allows a placeholder the source declares, on both hosts", () => {
    /* Vercel's path-to-regexp reads ":year" in a source the way Cloudflare
       does, so this one needs no translation and must not be refused —
       over-refusing would make the emitter narrower than either host. */
    const config: HostConfig = {
      headers: [],
      redirects: [{ from: "/blog/:year", to: "/news/:year", status: 301 }]
    };
    expect(JSON.parse(vercelJson(config))).toMatchObject({
      redirects: [{ source: "/blog/:year", destination: "/news/:year", permanent: true }]
    });
  });

  it("allows a wildcard source pointed at a fixed path", () => {
    /* Both hosts drop the tail here, so the neutral form means the same thing
       on both and there is nothing to translate. */
    const text = vercelJson({ headers: [], redirects: [{ from: "/old/*", to: "/new" }] });
    expect(JSON.parse(text)).toMatchObject({
      redirects: [{ source: "/old/(.*)", destination: "/new", permanent: false }]
    });
  });

  it("still emits shade's real redirect", () => {
    /* The only redirect in the fleet. The refusal is worthless if it costs the
       one site that has one its vercel.json. */
    const text = vercelJson({ headers: [], redirects: [{ from: "/about.html", to: "/", status: 301 }] });
    expect(JSON.parse(text)).toMatchObject({
      redirects: [{ source: "/about.html", destination: "/", permanent: true }]
    });
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

/* The five headers the hand-written functions/_middleware.js on
   site-template's cloudflare-proof branch sets, copied from that file. It is
   the artefact this emitter has to replace, so the generated middleware is
   held to its effect rather than to its text — it cannot match its text,
   because that file restates the "/*" rule by hand and says in its own header
   that generating it is the fix. */
const HANDWRITTEN = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
};

/* Run the emitted file, rather than assert about its source.
   ---------------------------------------------------------------------------
   This is the kit's one generator of code somebody else executes, and the
   lesson of 9.5 is that cloudflareHeaders() and cloudflareRedirects() shipped
   in 0.2.0, were exported, and were never once invoked until a session called
   them and found a bug in the first minute. A test that greps the source would
   repeat that. A data: URL import is enough here because Pages Functions are
   Web-standard modules — Request, Response and Headers behave the same in
   Node — so what is left untested is only whether Pages calls onRequest, which
   no unit test on any host can answer. */
async function middleware(config: HostConfig) {
  const source = cloudflareMiddleware(config);
  const module = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  return module.onRequest as (context: unknown) => Promise<Response>;
}

/* What a Function hands back: its own headers, its own status, a body. */
function request(path: string, response: Response) {
  return { request: new Request(`https://example.com${path}`), next: async () => response };
}

describe("cloudflareMiddleware", () => {
  it("puts the config's headers on a Function response, which _headers cannot", async () => {
    const onRequest = await middleware(ELFINE);
    const response = await onRequest(
      request(
        "/api/feedback",
        new Response('{"ok":true}', {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
        })
      )
    );

    /* Finding 1's measurement was 0 of 5 here. */
    for (const [key, value] of Object.entries(HANDWRITTEN)) {
      expect(response.headers.get(key)).toBe(value);
    }
    /* The handler's own headers survive — the whole reason the hand-written
       file copies rather than replaces. */
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe('{"ok":true}');
  });

  it("applies a path-scoped rule only where it matches", async () => {
    const onRequest = await middleware(ELFINE);

    /* "/api/*" is the rule that says no-store, and elfine's config declares it
       for exactly this reason — a Function that forgot would still be right. */
    const api = await onRequest(request("/api/content", new Response("{}")));
    expect(api.headers.get("Cache-Control")).toBe("no-store");

    /* An exact rule is exact: /favicon.svg gets the long cache, and a page
       does not. */
    const icon = await onRequest(request("/favicon.svg", new Response("<svg/>")));
    expect(icon.headers.get("Cache-Control")).toBe(
      "public, max-age=86400, stale-while-revalidate=2592000"
    );
    const page = await onRequest(request("/", new Response("<html>")));
    expect(page.headers.get("Cache-Control")).toBe(null);
    /* …and still carries the security headers, because "/*" matched it. */
    expect(page.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });

  it("preserves the status and statusText it was handed", async () => {
    /* The rate limiter's 429 is the response most likely to be read by a
       person, and rebuilding a Response is where a status gets dropped. */
    const onRequest = await middleware(ELFINE);
    const response = await onRequest(
      request("/api/feedback", new Response("slow down", { status: 429, statusText: "Too Many Requests" }))
    );
    expect(response.status).toBe(429);
    expect(response.statusText).toBe("Too Many Requests");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("returns the response untouched when no rule matches", async () => {
    /* Not an optimisation — a site whose config says nothing about a path
       should get exactly what its Function returned, byte for byte and object
       for object. */
    const onRequest = await middleware({
      headers: [{ path: "/api/*", headers: { "Cache-Control": "no-store" } }]
    });
    const original = new Response("<html>");
    expect(await onRequest(request("/about", original))).toBe(original);
  });

  it("declares the same rules _headers declares", async () => {
    /* One definition, two hosts, and now three artefacts on one of them. The
       thing that must never happen is the middleware and _headers disagreeing,
       which is what four hand-written copies of anything eventually do. */
    const source = cloudflareMiddleware(ELFINE);
    for (const rule of ELFINE.headers) {
      expect(source).toContain(`"path": "${rule.path}"`);
      for (const [key, value] of Object.entries(rule.headers)) {
        expect(source).toContain(`"${key}": ${JSON.stringify(value)}`);
      }
    }
    /* Generated, and it says so where somebody will read it. */
    expect(source.startsWith("/* Generated by sitekit-headers --cloudflare")).toBe(true);
  });

  it("survives a header value carrying quotes, which a CSP does", async () => {
    /* The emitter writes JavaScript, so a value is a quoting hazard rather
       than just data. A CSP is the realistic one and the editor route ships
       one. */
    const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'";
    const onRequest = await middleware({
      headers: [{ path: "/*", headers: { "Content-Security-Policy": csp } }]
    });
    const response = await onRequest(request("/", new Response("<html>")));
    expect(response.headers.get("Content-Security-Policy")).toBe(csp);
  });
});
