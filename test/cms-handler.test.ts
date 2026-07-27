import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { z } from "zod";
import { createContentHandler } from "../src/cms/handler.js";
import { createAuthHandler } from "../src/cms/auth.js";
import { issueSession } from "../src/cms/session.js";
import { normalize } from "../src/cms/yaml.js";

const SECRET = "per-site-session-secret";
const REPO = "shaahink/behrooz-website";
const ORIGIN = "https://bez-website.vercel.app";
const HOST = "bez-website.vercel.app";

const schema = z.object({
  meta: z.object({ title: z.string().max(40), canonical: z.string() }),
  hero: z.object({ tagline: z.string(), slides: z.array(z.object({ alt: z.string() })) })
});

const SOURCE = normalize(`meta:
  title: "Bruce Nemeth"
  canonical: "/"

hero:
  tagline: >-
    An interdisciplinary artist listening for the difference inside everything
    that seems to repeat.
  slides:
    - alt: "A black canvas"
    - alt: "Red brushstrokes"
`);

const env = {
  sessionSecret: SECRET,
  googleClientId: "1234.apps.googleusercontent.com",
  allowlist: "shaahin69@gmail.com",
  token: "ghp_test",
  repo: REPO
};

const handler = createContentHandler({
  collections: {
    home: { schema, file: "src/content/pages/home.yaml", omit: ["hero.slides[].w"] },
    works: { schema, dir: "src/content/works" }
  },
  env
});

/* What GitHub returned last, and what it should return next. */
let stored: { text: string; sha: string };
let puts: Array<Record<string, any>>;

function utf8Base64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

beforeEach(async () => {
  stored = { text: SOURCE, sha: "sha-original" };
  puts = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (init?.method === "PUT") {
      const body = JSON.parse(init.body as string);
      puts.push(body);
      if (body.sha !== stored.sha) return jsonResponse({ message: "conflict" }, 409);
      stored = { text: Buffer.from(body.content, "base64").toString("utf8"), sha: "sha-next" };
      return jsonResponse({ content: { sha: "sha-next" }, commit: { html_url: "https://gh/c/1" } });
    }
    if (path.endsWith("/src/content/works")) {
      return jsonResponse([
        { type: "file", name: "wordless.yaml" },
        { type: "file", name: "forgotten.yaml" },
        { type: "file", name: "notes.md" }
      ]);
    }
    if (path.includes("/contents/")) {
      return jsonResponse({ type: "file", content: utf8Base64(stored.text), sha: stored.sha });
    }
    return jsonResponse({ message: "unexpected" }, 404);
  });
});

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

async function cookie(email = "shaahin69@gmail.com"): Promise<string> {
  const set = await issueSession({ sub: "108134", email, name: "Shahin Kiassat" }, { secret: SECRET });
  return set.split(";")[0] as string;
}

function get(params: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://${HOST}/api/content${params}`, { headers: { host: HOST, ...headers } });
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://${HOST}/api/content`, {
    method: "POST",
    headers: { host: HOST, origin: ORIGIN, "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

describe("the gate", () => {
  it("says so plainly when the site isn't configured yet", async () => {
    const bare = createContentHandler({ collections: {}, env: {} });
    expect((await bare.GET(get(""))).status).toBe(503);
  });

  it("turns away a request with no session", async () => {
    const response = await handler.GET(get("?collection=home"));
    expect(response.status).toBe(401);
  });

  it("turns away a signed-in account that isn't on the allowlist", async () => {
    const response = await handler.GET(
      get("?collection=home", { cookie: await cookie("stranger@example.com") })
    );
    expect(response.status).toBe(403);
  });

  it("re-checks the allowlist on every request, not just at sign-in", async () => {
    const removed = createContentHandler({
      collections: { home: { schema, file: "src/content/pages/home.yaml" } },
      env: { ...env, allowlist: "someone-else@example.com" }
    });
    /* A cookie minted while they were still allowed. */
    const response = await removed.GET(get("?collection=home", { cookie: await cookie() }));
    expect(response.status).toBe(403);
  });

  it("refuses a write from another origin", async () => {
    const response = await handler.POST(
      post({ collection: "home", edits: [], sha: "x" }, { origin: "https://evil.test", cookie: await cookie() })
    );
    expect(response.status).toBe(403);
  });
});

describe("GET", () => {
  it("lists what there is to edit, resolving a directory collection", async () => {
    const response = await handler.GET(get("", { cookie: await cookie() }));
    const body = await response.json();
    expect(body.who).toBe("shaahin69@gmail.com");
    expect(body.collections).toEqual([
      { name: "home", label: "home", entries: ["home"] },
      { name: "works", label: "works", entries: ["forgotten", "wordless"] }
    ]);
  });

  it("returns the form model, the values and the sha to write against", async () => {
    const response = await handler.GET(get("?collection=home", { cookie: await cookie() }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sha).toBe("sha-original");
    expect(body.path).toBe("src/content/pages/home.yaml");
    expect(body.values.hero.slides[0].alt).toBe("A black canvas");
    const paths = JSON.stringify(body.fields);
    expect(paths).toContain("hero.tagline");
    expect(paths).not.toContain("hero.slides[].w");
  });

  it("404s an unknown collection", async () => {
    const response = await handler.GET(get("?collection=nope", { cookie: await cookie() }));
    expect(response.status).toBe(404);
  });

  it("refuses an entry name that could climb out of the directory", async () => {
    const response = await handler.GET(
      get("?collection=works&entry=..%2F..%2Fsecrets", { cookie: await cookie() })
    );
    expect(response.status).toBe(400);
  });
});

describe("POST", () => {
  it("commits the edit and names the human in the message", async () => {
    const response = await handler.POST(
      post(
        {
          collection: "home",
          edits: [{ path: "hero.tagline", value: "A shorter tagline." }],
          sha: "sha-original"
        },
        { cookie: await cookie() }
      )
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.commit).toBe("https://gh/c/1");

    const commit = puts[0]!;
    expect(commit.message).toContain("Edit home.yaml: hero.tagline");
    expect(commit.message).toContain("Shahin Kiassat <shaahin69@gmail.com>");
    expect(Buffer.from(commit.content, "base64").toString("utf8")).toContain("A shorter tagline.");
  });

  it("writes non-Latin content as UTF-8", async () => {
    await handler.POST(
      post(
        { collection: "home", edits: [{ path: "meta.title", value: "بهروز" }], sha: "sha-original" },
        { cookie: await cookie() }
      )
    );
    expect(Buffer.from(puts[0]!.content, "base64").toString("utf8")).toContain("بهروز");
  });

  it("refuses an edit based on a version that has moved on", async () => {
    const response = await handler.POST(
      post(
        { collection: "home", edits: [{ path: "hero.tagline", value: "x" }], sha: "sha-stale" },
        { cookie: await cookie() }
      )
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/reload/);
    expect(puts).toHaveLength(0);
  });

  it("re-validates the whole document, so a too-long value never lands", async () => {
    const response = await handler.POST(
      post(
        {
          collection: "home",
          edits: [{ path: "meta.title", value: "x".repeat(80) }],
          sha: "sha-original"
        },
        { cookie: await cookie() }
      )
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.issues[0].path).toBe("meta.title");
    expect(puts).toHaveLength(0);
  });

  it("rejects a payload that deletes a required field", async () => {
    const response = await handler.POST(
      post(
        { collection: "home", edits: [{ path: "meta.canonical", value: 42 }], sha: "sha-original" },
        { cookie: await cookie() }
      )
    );
    expect(response.status).toBe(400);
    expect(puts).toHaveLength(0);
  });

  it("has nothing to do with an empty edit list", async () => {
    const response = await handler.POST(
      post({ collection: "home", edits: [], sha: "sha-original" }, { cookie: await cookie() })
    );
    expect(response.status).toBe(400);
  });

  it("insists on knowing which version the edit was based on", async () => {
    const response = await handler.POST(
      post(
        { collection: "home", edits: [{ path: "meta.title", value: "ok" }] },
        { cookie: await cookie() }
      )
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/version/);
  });
});

describe("the auth endpoint", () => {
  const auth = createAuthHandler({ env });

  it("refuses a credential from another origin", async () => {
    const request = new Request("https://bez-website.vercel.app/api/auth", {
      method: "POST",
      headers: { host: HOST, origin: "https://evil.test", "content-type": "application/json" },
      body: JSON.stringify({ credential: "x" })
    });
    expect((await auth.POST(request)).status).toBe(403);
  });

  it("rejects a credential that isn't a real Google token", async () => {
    const request = new Request("https://bez-website.vercel.app/api/auth", {
      method: "POST",
      headers: { host: HOST, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ credential: "not.a.token" })
    });
    expect((await auth.POST(request)).status).toBe(401);
  });

  it("clears the cookie on sign-out", async () => {
    const response = await auth.DELETE();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
