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

/** A cookie minted 50 minutes ago against a one-hour lifetime — still valid,
    and past the halfway mark where the handler should slide it forward. */
async function staleCookie(): Promise<string> {
  const set = await issueSession(
    { sub: "108134", email: "shaahin69@gmail.com", name: "Shahin Kiassat" },
    { secret: SECRET, now: Date.now() - 50 * 60 * 1000 }
  );
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

  /* The device marker `editor/hint.ts` writes so an owner can find their own
     editor. It is a key and an expiry in a site's own `localStorage`, it grants
     nothing, and this is the assertion that says so against the real gate
     rather than in a comment: offered as a cookie, offered as a header, offered
     beside a session belonging to somebody who is not allowed here, it changes
     the answer by not one byte. Nothing in the kit reads it server-side, and
     the day something starts to, these fail. */
  describe("the device marker grants nothing", () => {
    const marker = String(Date.now() + 90 * 86_400_000);

    it("is not a session, however it is offered", async () => {
      const plain = await handler.GET(get("?collection=home"));
      const asCookie = await handler.GET(get("?collection=home", { cookie: `sk-edit-here=${marker}` }));
      const asHeader = await handler.GET(get("?collection=home", { "x-sk-edit-here": marker }));

      expect(plain.status).toBe(401);
      expect(asCookie.status).toBe(401);
      expect(asHeader.status).toBe(401);
      const refusal = await plain.text();
      expect(await asCookie.text()).toBe(refusal);
      expect(await asHeader.text()).toBe(refusal);
    });

    it("does not get an account past the allowlist", async () => {
      const response = await handler.GET(
        get("?collection=home", {
          cookie: `${await cookie("stranger@example.com")}; sk-edit-here=${marker}`
        })
      );
      expect(response.status).toBe(403);
    });

    it("does not survive a session being rejected — a write is refused the same way", async () => {
      const response = await handler.POST(
        post(
          { collection: "home", edits: [], sha: "sha-original" },
          { cookie: `sk-edit-here=${marker}` }
        )
      );
      expect(response.status).toBe(401);
      expect(puts).toHaveLength(0);
    });
  });

  it("refuses a write from another origin", async () => {
    const response = await handler.POST(
      post({ collection: "home", edits: [], sha: "x" }, { origin: "https://evil.test", cookie: await cookie() })
    );
    expect(response.status).toBe(403);
  });

  /* Sliding the expiry forward while an owner is working is what stops "my
     sign-in lapsed" being something they discover from a failed save. */
  it("leaves a fresh session's cookie alone", async () => {
    const response = await handler.GET(get("?collection=home", { cookie: await cookie() }));
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("renews a session that is past halfway, on a read", async () => {
    const response = await handler.GET(get("?collection=home", { cookie: await staleCookie() }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=3600");
  });

  it("renews on a write too, so a long editing session never lapses mid-save", async () => {
    const response = await handler.POST(
      post(
        { collection: "home", sha: "sha-original", edits: [{ path: "hero.tagline", value: "New" }] },
        { cookie: await staleCookie() }
      )
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=3600");
  });

  it("does not hand a removed account a fresh hour on its way out", async () => {
    const removed = createContentHandler({
      collections: { home: { schema, file: "src/content/pages/home.yaml" } },
      env: { ...env, allowlist: "someone-else@example.com" }
    });
    const response = await removed.GET(get("?collection=home", { cookie: await staleCookie() }));
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("GET", () => {
  it("lists what there is to edit, resolving a directory collection", async () => {
    const response = await handler.GET(get("", { cookie: await cookie() }));
    const body = await response.json();
    expect(body.who).toBe("shaahin69@gmail.com");
    expect(body.collections).toEqual([
      { name: "home", label: "home", entries: [{ id: "home", label: "home" }] },
      {
        name: "works",
        label: "works",
        entries: [
          { id: "forgotten", label: "forgotten" },
          { id: "wordless", label: "wordless" }
        ]
      }
    ]);
  });

  it("labels an entry from the site's config when it has one", async () => {
    const bilingual = createContentHandler({
      collections: {
        works: {
          schema,
          dir: "src/content/works",
          entryLabels: { forgotten: "Forgotten (English)" }
        }
      },
      env
    });
    const response = await bilingual.GET(get("", { cookie: await cookie() }));
    const body = await response.json();
    /* Labelled where the site said so, and falling back to the file name
       where it didn't — a half-filled entryLabels map must not blank out the
       entries it doesn't mention. */
    expect(body.collections[0].entries).toEqual([
      { id: "forgotten", label: "Forgotten (English)" },
      { id: "wordless", label: "wordless" }
    ]);
  });

  /* The panel's only way onto the page itself, which is the only way onto
     inline editing that does not involve typing `?edit=1` into a phone's URL
     bar. */
  it("tells the panel where each entry can be seen on the site", async () => {
    const linked = createContentHandler({
      collections: {
        home: { schema, file: "src/content/pages/home.yaml", entryUrl: { home: "/" } },
        works: { schema, dir: "src/content/works", entryUrl: "/works/{entry}.html" }
      },
      env
    });
    const body = await (await linked.GET(get("", { cookie: await cookie() }))).json();
    expect(body.collections[0].entries).toEqual([{ id: "home", label: "home", url: "/" }]);
    expect(body.collections[1].entries).toEqual([
      { id: "forgotten", label: "forgotten", url: "/works/forgotten.html" },
      { id: "wordless", label: "wordless", url: "/works/wordless.html" }
    ]);
  });

  it("omits a url rather than emitting one that leaves the site", async () => {
    /* This value becomes an href the owner taps inside their own editor. Only
       the site's own config writes it, and it is still checked. */
    const bad = createContentHandler({
      collections: {
        home: { schema, file: "src/content/pages/home.yaml", entryUrl: "https://example.com/" },
        works: { schema, dir: "src/content/works", entryUrl: "//example.com/{entry}" }
      },
      env
    });
    const body = await (await bad.GET(get("", { cookie: await cookie() }))).json();
    expect(body.collections[0].entries[0]).toEqual({ id: "home", label: "home" });
    expect(body.collections[1].entries[0]).toEqual({ id: "forgotten", label: "forgotten" });
  });

  it("says nothing about urls when the site hasn't declared any", async () => {
    const body = await (await handler.GET(get("", { cookie: await cookie() }))).json();
    expect(body.collections[0].entries[0]).toEqual({ id: "home", label: "home" });
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

  /* Session 16, F2 — measured against a real repository, not reasoned about.
     Zod strips unknown keys, so the whole-document re-validation above passed an
     edit to a path the schema has never heard of, and the junk subtree landed in
     the site's content under a 200 and the word "Saved". */
  it("refuses an edit to a path the schema has no field for, rather than committing it", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handler.POST(
      post(
        {
          collection: "home",
          edits: [{ path: "nothing.like.this", value: "junk" }],
          sha: "sha-original"
        },
        { cookie: await cookie() }
      )
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.issues[0].path).toBe("nothing.like.this");
    expect(puts).toHaveLength(0);
    /* And the operator can find out, which the silent version could not offer. */
    expect(errors.mock.calls.flat().join(" ")).toContain("nothing.like.this");
    errors.mockRestore();
  });

  it("refuses the whole save when one edit of several is unknown", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handler.POST(
      post(
        {
          collection: "home",
          edits: [
            { path: "hero.tagline", value: "fine" },
            { path: "hero.smuggled", value: "not fine" }
          ],
          sha: "sha-original"
        },
        { cookie: await cookie() }
      )
    );
    expect(response.status).toBe(400);
    /* All or nothing: half-applying a save would leave an owner unable to tell
       what landed. */
    expect(puts).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it("still saves an array whole, which is how a row moves", async () => {
    /* The guard's most likely way to be wrong. An array's own path is not a
       scalar field, and a reorder is expressed as the whole array — refuse that
       and adding, removing or moving a row stops working everywhere. */
    const response = await handler.POST(
      post(
        {
          collection: "home",
          edits: [{ path: "hero.slides", value: [{ alt: "Red brushstrokes" }, { alt: "A black canvas" }] }],
          sha: "sha-original"
        },
        { cookie: await cookie() }
      )
    );
    expect(response.status).toBe(200);
    expect(Buffer.from(puts[0]!.content, "base64").toString("utf8")).toMatch(
      /slides:[\s\S]*Red brushstrokes[\s\S]*A black canvas/
    );
  });

  it("still saves a row inside an array by its concrete index", async () => {
    const response = await handler.POST(
      post(
        {
          collection: "home",
          edits: [{ path: "hero.slides[1].alt", value: "Vermilion" }],
          sha: "sha-original"
        },
        { cookie: await cookie() }
      )
    );
    expect(response.status).toBe(200);
    expect(Buffer.from(puts[0]!.content, "base64").toString("utf8")).toContain("Vermilion");
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

  it("publishes the client ID so the page can render a working button", async () => {
    const body = await (await auth.GET()).json();
    /* `paths` joined the answer at 0.19.0. A site with a Google client and no
       `CMS_AUTH_ORIGIN` offers exactly one way in and says so by name — which
       is what lets the editor stop treating `configured` as a synonym for
       "render Google's button". */
    expect(body).toEqual({
      ok: true,
      configured: true,
      paths: ["google"],
      clientId: env.googleClientId
    });
  });

  it("reports itself unconfigured rather than serving a button that can't work", async () => {
    const bare = createAuthHandler({ env: { sessionSecret: "x" } });
    const body = await (await bare.GET()).json();
    expect(body.configured).toBe(false);
    expect(body.clientId).toBeUndefined();
  });
});
