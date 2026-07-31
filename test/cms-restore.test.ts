/* Putting a change back.
   ---------------------------------------------------------------------------
   Every one of restore.ts's five refusals has a test here, because the whole
   value of this feature is that it says no correctly: a "put it back" that
   quietly deletes a page, silently overwrites somebody else's save, or commits
   content the build will then reject is worse than the support ticket it
   replaces.

   The GitHub double is deliberately a small git: it holds a commit graph with
   real file contents per commit, so `compare`, the three reads and the tree
   write all answer from the same state rather than from per-test canned
   responses that can be made to agree with a wrong implementation. */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod";
import { putBack, RestoreError, restoreMessage } from "../src/cms/restore.js";
import { recentChanges } from "../src/cms/history.js";
import { createContentHandler } from "../src/cms/handler.js";
import { issueSession } from "../src/cms/session.js";

const REPO = "shaahink/elfine-site";
const ACCESS = { repo: REPO, token: "t", userAgent: "test", branch: "main" };

const schema = z.object({
  meta: z.object({ title: z.string() }),
  contact: z.object({ email: z.string() })
});

const collections = {
  site: { schema, dir: "src/content/site" }
};

const EN = "src/content/site/site.en.yaml";
const FR = "src/content/site/site.fr.yaml";

function yaml(title: string, email: string): string {
  return `meta:\n  title: "${title}"\n\ncontact:\n  email: "${email}"\n`;
}

/* --- a very small git ---------------------------------------------------- */

interface Commit {
  sha: string;
  parents: string[];
  message: string;
  at: string;
  /** The whole tree at this commit, path → text. */
  tree: Record<string, string>;
}

let commits: Commit[];
let head: string;
/** Every PATCH of the branch ref, so a test can prove nothing was written. */
let refMoves: string[];
let blobs: Record<string, string>;

function at(sha: string): Commit {
  const found = commits.find((commit) => commit.sha === sha);
  if (!found) throw new Error(`test git: no commit ${sha}`);
  return found;
}

/** A blob sha that is a pure function of the bytes, which is what git's is —
    so "has this file moved" is answered by content, as it is for real. */
function blobSha(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return `blob${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function utf8Base64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

beforeEach(() => {
  refMoves = [];
  blobs = {};
  commits = [
    {
      sha: "aaaaaaa111111111111111111111111111111111",
      parents: [],
      message: "Build the site",
      at: "2026-07-01T09:00:00Z",
      tree: { [EN]: yaml("Elfine", "hello@elfine.example"), [FR]: yaml("Elfine", "hello@elfine.example") }
    },
    {
      sha: "bbbbbbb222222222222222222222222222222222",
      parents: ["aaaaaaa111111111111111111111111111111111"],
      message:
        "Edit site.en.yaml: contact.email\n\nChanged by Elfine <e@example.org> through the site editor.",
      at: "2026-07-30T09:00:00Z",
      tree: { [EN]: yaml("Elfine", "elfine@real.fr"), [FR]: yaml("Elfine", "hello@elfine.example") }
    }
  ];
  head = "bbbbbbb222222222222222222222222222222222";

  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;

    /* The change list. */
    if (path === `/repos/${REPO}/commits`) {
      const wanted = parsed.searchParams.get("path") ?? "";
      const touching = commits
        .filter((commit) => {
          const parent = commit.parents[0] ? at(commit.parents[0]).tree : {};
          return Object.keys(commit.tree).some(
            (file) => file.startsWith(wanted) && commit.tree[file] !== parent[file]
          );
        })
        .sort((a, b) => b.at.localeCompare(a.at));
      return jsonResponse(
        touching.map((commit) => ({
          sha: commit.sha,
          html_url: `https://github.com/${REPO}/commit/${commit.sha.slice(0, 7)}`,
          commit: { author: { date: commit.at }, message: commit.message }
        }))
      );
    }

    const one = /^\/repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]+)$/.exec(path);
    if (one) {
      const commit = at(one[1] as string);
      return jsonResponse({
        sha: commit.sha,
        parents: commit.parents.map((sha) => ({ sha })),
        commit: { message: commit.message }
      });
    }

    const compare = /^\/repos\/[^/]+\/[^/]+\/compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)$/.exec(path);
    if (compare) {
      const base = at(compare[1] as string).tree;
      const headTree = at(compare[2] as string).tree;
      const files = [...new Set([...Object.keys(base), ...Object.keys(headTree)])]
        .filter((file) => base[file] !== headTree[file])
        .map((file) => ({
          filename: file,
          status: base[file] === undefined ? "added" : headTree[file] === undefined ? "removed" : "modified"
        }));
      return jsonResponse({ files });
    }

    if (path.startsWith(`/repos/${REPO}/contents/`)) {
      const file = decodeURIComponent(path.slice(`/repos/${REPO}/contents/`.length));
      const ref = parsed.searchParams.get("ref") ?? "main";
      const tree = at(ref === "main" ? head : ref).tree;
      const text = tree[file];
      if (text === undefined) return jsonResponse({ message: "Not Found" }, 404);
      return jsonResponse({ type: "file", content: utf8Base64(text), sha: blobSha(text) });
    }

    if (path === `/repos/${REPO}/git/ref/heads/main`) {
      return jsonResponse({ object: { sha: head } });
    }
    const gitCommit = /\/git\/commits\/([0-9a-f]+)$/.exec(path);
    if (method === "GET" && gitCommit) {
      return jsonResponse({ tree: { sha: `tree-${gitCommit[1]}` } });
    }
    const gitTree = /\/git\/trees\/tree-([0-9a-f]+)$/.exec(path);
    if (method === "GET" && gitTree) {
      const tree = at(gitTree[1] as string).tree;
      return jsonResponse({
        tree: Object.entries(tree).map(([file, text]) => ({ path: file, sha: blobSha(text) }))
      });
    }
    if (method === "POST" && path.endsWith("/git/blobs")) {
      const text = Buffer.from(body.content, body.encoding === "base64" ? "base64" : "utf8").toString(
        "utf8"
      );
      const sha = `new-${Object.keys(blobs).length}`;
      blobs[sha] = text;
      return jsonResponse({ sha });
    }
    if (method === "POST" && path.endsWith("/git/trees")) {
      const base = at((/tree-([0-9a-f]+)$/.exec(body.base_tree) as RegExpExecArray)[1] as string).tree;
      const next = { ...base };
      for (const item of body.tree) next[item.path] = blobs[item.sha] as string;
      const sha = `staged-${commits.length}`;
      staged[sha] = next;
      return jsonResponse({ sha });
    }
    if (method === "POST" && path.endsWith("/git/commits")) {
      const sha = `ccccccc${commits.length}`.padEnd(40, "0");
      commits.push({
        sha,
        parents: body.parents,
        message: body.message,
        at: "2026-07-31T09:00:00Z",
        tree: staged[body.tree] as Record<string, string>
      });
      return jsonResponse({ sha, html_url: `https://github.com/${REPO}/commit/${sha.slice(0, 7)}` });
    }
    if (method === "PATCH" && path.endsWith("/git/refs/heads/main")) {
      refMoves.push(body.sha);
      head = body.sha;
      return jsonResponse({ object: { sha: body.sha } });
    }

    return jsonResponse({ message: `unexpected ${method} ${path}` }, 404);
  });
});

let staged: Record<string, Record<string, string>> = {};
beforeEach(() => {
  staged = {};
});

afterEach(() => vi.unstubAllGlobals());

const WHO = { name: "Elfine", email: "e@example.org" };

/* --- the happy path ------------------------------------------------------ */

describe("putBack", () => {
  it("puts the content file back to the bytes it held before the change", async () => {
    const result = await putBack(ACCESS, collections, commits[1]!.sha, { who: WHO });

    expect(result.changed).toBe(true);
    expect(result.files).toEqual([EN]);
    expect(refMoves).toHaveLength(1);
    /* Read back off the resulting tree rather than off the return value: the
       point of the whole feature is what the repository now holds. */
    expect(at(head).tree[EN]).toBe(yaml("Elfine", "hello@elfine.example"));
    /* And the file the change never touched is untouched. */
    expect(at(head).tree[FR]).toBe(yaml("Elfine", "hello@elfine.example"));
  });

  it("writes the parent's bytes verbatim rather than re-serialising them", async () => {
    /* The RTL trap, pinned: Persian digits, ZWNJ and every quoting choice
       survive a restore by never being parsed on the way out. A round trip
       through the YAML writer would normalise all three. */
    const persian = 'meta:\n  title: "مطب ۱۲۳"\n\ncontact:\n  email: "می‌رود@x.fr"\n';
    commits[0]!.tree[EN] = persian;
    commits[1]!.tree[EN] = yaml("changed", "a@b.fr");

    await putBack(ACCESS, collections, commits[1]!.sha, { who: WHO });

    const written = at(head).tree[EN] as string;
    expect(written).toBe(persian);
    expect(Buffer.from(written, "utf8")).toEqual(Buffer.from(persian, "utf8"));
    expect(written).toContain("‌");
    expect(written).toContain("۱۲۳");
  });

  it("puts back every content file one change touched, in one commit", async () => {
    commits[1]!.tree[FR] = yaml("Elfine", "bonjour@real.fr");

    const result = await putBack(ACCESS, collections, commits[1]!.sha, { who: WHO });

    expect(result.files.sort()).toEqual([EN, FR]);
    expect(refMoves).toHaveLength(1);
    expect(at(head).tree[EN]).toBe(yaml("Elfine", "hello@elfine.example"));
    expect(at(head).tree[FR]).toBe(yaml("Elfine", "hello@elfine.example"));
  });

  it("names the person in the commit, the way a save does", async () => {
    await putBack(ACCESS, collections, commits[1]!.sha, { who: WHO });
    expect(at(head).message).toContain("Changed by Elfine <e@example.org> through the site editor.");
    expect(at(head).message.split("\n")[0]).toBe("Put site.en.yaml back to how it was before bbbbbbb");
  });

  it("puts back a merge commit, against its first parent", async () => {
    /* Elfine's own change list is exactly this: a redesign that reached her
       live site through a merge rather than a decision. A merge's own `files`
       is a combined diff and would have been empty here; `compare` against
       parents[0] is what makes the motivating case work at all. */
    commits.push({
      sha: "ddddddd444444444444444444444444444444444",
      parents: ["bbbbbbb222222222222222222222222222222222", "eeeeeee555555555555555555555555555555555"],
      message: "Variant A — the paged book (#57)",
      at: "2026-07-30T18:00:00Z",
      tree: { [EN]: yaml("Elfine — variant A", "elfine@real.fr"), [FR]: yaml("Elfine", "hello@elfine.example") }
    });
    head = "ddddddd444444444444444444444444444444444";

    const result = await putBack(ACCESS, collections, "ddddddd444444444444444444444444444444444", {
      who: WHO
    });

    expect(result.changed).toBe(true);
    expect(at(head).tree[EN]).toBe(yaml("Elfine", "elfine@real.fr"));
  });

  it("changes nothing and says so when the site already holds that version", async () => {
    /* Pressing the same row twice. The first press writes; the second finds
       the file already holding what it would write and does nothing — an empty
       commit here would be a production deploy for no change, out of a rolling
       budget six other sites draw on. */
    const first = await putBack(ACCESS, collections, commits[1]!.sha, { who: WHO });
    expect(first.changed).toBe(true);
    expect(refMoves).toHaveLength(1);

    const again = await putBack(ACCESS, collections, commits[1]!.sha, { who: WHO });
    expect(again.changed).toBe(false);
    expect(again.files).toEqual([]);
    expect(refMoves).toHaveLength(1);
  });

  it("says the same when somebody already put it back by hand", async () => {
    /* Reachable a second way, and it is why the "already there" question is
       asked before the "has anything changed since" one: a hand commit that
       restored the same bytes leaves the site in exactly the state the button
       would produce, and calling that a conflict would leave an owner told
       something is wrong with no way forward. */
    commits.push({
      sha: "4444444aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      parents: [head],
      message: "Put the address back by hand",
      at: "2026-07-31T07:00:00Z",
      tree: { ...at(head).tree, [EN]: yaml("Elfine", "hello@elfine.example") }
    });
    head = "4444444aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    const result = await putBack(ACCESS, collections, commits[1]!.sha, { who: WHO });
    expect(result.changed).toBe(false);
    expect(refMoves).toEqual([]);
  });

  it("puts back only the files that still need it", async () => {
    /* One of the two files this change touched has already been put back; the
       other has not. Writing both would make a commit that says it moved two
       pages and moved one. */
    commits[1]!.tree[FR] = yaml("Elfine", "bonjour@real.fr");
    commits.push({
      sha: "5555555bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      parents: [head],
      message: "Put the French address back by hand",
      at: "2026-07-31T07:00:00Z",
      tree: { ...commits[1]!.tree, [FR]: yaml("Elfine", "hello@elfine.example") }
    });
    head = "5555555bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    const result = await putBack(ACCESS, collections, commits[1]!.sha, { who: WHO });
    expect(result.files).toEqual([EN]);
    expect(at(head).tree[EN]).toBe(yaml("Elfine", "hello@elfine.example"));
  });
});

/* --- the five refusals --------------------------------------------------- */

describe("putBack refuses", () => {
  const refuses = async (sha: string): Promise<string> => {
    try {
      await putBack(ACCESS, collections, sha, { who: WHO });
    } catch (error) {
      expect(error).toBeInstanceOf(RestoreError);
      return (error as Error).message;
    }
    throw new Error("expected a refusal");
  };

  it("a sha the change list did not show", async () => {
    commits.push({
      sha: "fffffff666666666666666666666666666666666",
      parents: [head],
      message: "Bump a dependency",
      at: "2026-07-31T08:00:00Z",
      tree: at(head).tree
    });
    expect(await refuses("fffffff666666666666666666666666666666666")).toContain(
      "isn't a change this editor knows"
    );
    /* And a sha that is not a sha at all never reaches GitHub. */
    expect(await refuses("../../etc/passwd")).toContain("isn't a change this editor knows");
    expect(refMoves).toEqual([]);
  });

  it("a commit with no parent", async () => {
    /* The first commit in a repository. `recentChanges` shows it, because it
       created the content, and there is no "before" to go back to. */
    expect(await refuses(commits[0]!.sha)).toContain("nothing before this change");
    expect(refMoves).toEqual([]);
  });

  it("a change that added or removed a page", async () => {
    commits.push({
      sha: "1111111777777777777777777777777777777777",
      parents: [head],
      message: "Add a page",
      at: "2026-07-31T08:00:00Z",
      tree: { ...at(head).tree, "src/content/site/site.de.yaml": yaml("Elfine", "hallo@real.de") }
    });
    head = "1111111777777777777777777777777777777777";

    const message = await refuses(head);
    expect(message).toContain("added or removed 1 page");
    expect(message).toContain("ask for that one");
    expect(refMoves).toEqual([]);
  });

  it("a change something has been saved over since", async () => {
    commits.push({
      sha: "2222222888888888888888888888888888888888",
      parents: [head],
      message: "Edit site.en.yaml: meta.title\n\nChanged by Someone <s@x.fr> through the site editor.",
      at: "2026-07-31T08:00:00Z",
      tree: { ...at(head).tree, [EN]: yaml("Elfine Kh.", "elfine@real.fr") }
    });
    head = "2222222888888888888888888888888888888888";

    const message = await refuses(commits[1]!.sha);
    expect(message).toContain("Put the newest change back first");
    /* Nothing was written, which is the property that makes the composition
       claim true: put the newest one back, then this one. */
    expect(refMoves).toEqual([]);
    expect(at(head).tree[EN]).toBe(yaml("Elfine Kh.", "elfine@real.fr"));
  });

  it("content the schema would now refuse", async () => {
    /* The version being asked for is older than the schema it would land
       under. Committing it would be a "put it back" that breaks the build. */
    const strict = { site: { schema: schema.extend({ tagline: z.string() }), dir: "src/content/site" } };
    try {
      await putBack(ACCESS, strict, commits[1]!.sha, { who: WHO });
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(RestoreError);
      expect((error as Error).message).toContain("no longer fits this site's content model");
    }
    expect(refMoves).toEqual([]);
  });

  it("a change that touched no content at all", async () => {
    /* A code commit does appear in the list — it is filtered by path and a
       template lives outside the collections — and the honest answer is that
       there is nothing here this editor owns. */
    commits.push({
      sha: "3333333999999999999999999999999999999999",
      parents: [head],
      /* Touches a path inside the collection directory that is not an entry,
         so `recentChanges` shows it and `collectionOfPath` claims none of it. */
      message: "Move the layout",
      at: "2026-07-31T08:00:00Z",
      tree: { ...at(head).tree, "src/content/site/notes/readme.md": "hello" }
    });
    head = "3333333999999999999999999999999999999999";

    expect(await refuses(head)).toContain("didn't touch any of your words");
    expect(refMoves).toEqual([]);
  });
});

/* --- what the panel reads back ------------------------------------------- */

describe("the commit a restore writes", () => {
  it("is parsed back by the change list into something an owner recognises", async () => {
    await putBack(ACCESS, collections, commits[1]!.sha, { who: WHO });

    const changes = await recentChanges(ACCESS, ["src/content/site"], 5);
    expect(changes[0]?.summary).toBe("Put site.en back to how it was");
    expect(changes[0]?.who).toBe("Elfine");
  });

  it("says how many pages moved when it was more than one", () => {
    const message = restoreMessage([EN, FR], "bbbbbbb222222222222222222222222222222222", WHO);
    expect(message.split("\n")[0]).toBe(
      "Put site.en.yaml and 1 more back to how they were before bbbbbbb"
    );
  });

  it("is never mistaken for an edit", async () => {
    /* `Edit x: y` and `Put x back…` are two subjects and the panel must not
       humanise one as the other — a restore reading "Changed 1 thing" would be
       the list describing the wrong action. */
    await putBack(ACCESS, collections, commits[1]!.sha, { who: WHO });
    const changes = await recentChanges(ACCESS, ["src/content/site"], 5);
    expect(changes[0]?.summary).not.toContain("Changed");
    expect(changes[1]?.summary).toBe("Changed 1 thing on site.en");
  });
});

/* --- through the handler, which is how the panel reaches it -------------- */

describe("the content route", () => {
  const SECRET = "per-site-session-secret";
  const ORIGIN = "https://elfine-site.vercel.app";

  const handler = createContentHandler({
    collections,
    env: {
      sessionSecret: SECRET,
      googleClientId: "1234.apps.googleusercontent.com",
      allowlist: "e@example.org",
      token: "ghp_test",
      repo: REPO,
      branch: "main"
    }
  });

  async function cookie(): Promise<string> {
    return issueSession(
      { sub: "1", email: "e@example.org", name: "Elfine" },
      { secret: SECRET }
    );
  }

  async function post(body: unknown): Promise<Response> {
    return handler.POST(
      new Request(`${ORIGIN}/api/content`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: ORIGIN,
          Host: "elfine-site.vercel.app",
          Cookie: await cookie()
        },
        body: JSON.stringify(body)
      })
    );
  }

  it("puts a change back and reports what moved", async () => {
    const response = await post({ restore: { sha: commits[1]!.sha } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; restored: { changed: boolean; files: string[] } };
    expect(body.ok).toBe(true);
    expect(body.restored.changed).toBe(true);
    expect(body.restored.files).toEqual([EN]);
  });

  it("hands a refusal to the owner as a sentence, with a 400", async () => {
    const response = await post({ restore: { sha: commits[0]!.sha } });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("nothing before this change");
  });

  it("is behind the same gate as everything else here", async () => {
    /* No cookie: a restore is a write and it must not be reachable by anybody
       who could not also save. */
    const response = await handler.POST(
      new Request(`${ORIGIN}/api/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, Host: "elfine-site.vercel.app" },
        body: JSON.stringify({ restore: { sha: commits[1]!.sha } })
      })
    );
    expect(response.status).toBe(401);
    expect(refMoves).toEqual([]);
  });

  it("refuses a cross-origin restore", async () => {
    const response = await handler.POST(
      new Request(`${ORIGIN}/api/content`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://elsewhere.example",
          Host: "elfine-site.vercel.app",
          Cookie: await cookie()
        },
        body: JSON.stringify({ restore: { sha: commits[1]!.sha } })
      })
    );
    expect(response.status).toBe(403);
    expect(refMoves).toEqual([]);
  });
});
