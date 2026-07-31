/* Searching every page, not just the one that is open.
   ---------------------------------------------------------------------------
   Four things in here fail *quietly*, which is this suite's bar for a unit
   test rather than a browser pass.

   The freshness guard. A cached corpus that is not re-read when the branch
   moves hands an owner back the words they have just replaced — and it looks
   exactly like a search that is working. So the sha is asserted to be checked
   on every request, and a moved sha is asserted to re-read.

   The skip. The page in front of the owner is already searched instantly and
   client-side; if the server also offers it, one field has two rows and one of
   them reloads the page they are on. It is asserted by count, not by looking
   at the first row.

   The one matcher. `searchEntry` answers for both halves — that is the whole
   reason match.ts exists as a leaf. A test that only exercised the server
   would not notice the two drifting apart, so the last test here runs both
   over the same fixture and compares the spans.

   And the honest count. `total` must be the real number even when the list is
   capped, because "twenty-three matches" over a list of thirty is what tells
   an owner to narrow it — and a cap that lies reads as "that is all there
   is". */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { searchSite, createCorpusCache } from "../src/cms/search.js";
import { formModel } from "../src/cms/form.js";
import { searchEntry } from "../src/editor/match.js";
import { normalize, readValues } from "../src/cms/yaml.js";
import type { RepoAccess } from "../src/cms/contents.js";

const access: RepoAccess = {
  repo: "shaahink/elfine-site",
  token: "ghp_test",
  userAgent: "test"
};

/* Elfine's shape, cut down to the part that matters: a bilingual `site`
   collection of two entries, each carrying the contact block that has
   published a `.example` address since the site was built. */
const siteSchema = z.object({
  meta: z.object({ title: z.string() }),
  nav: z.object({ works: z.string().meta({ title: "Works" }) }),
  contact: z.object({
    heading: z.string().meta({ title: "Contact heading" }),
    email: z.string().meta({ title: "Email" })
  })
});

const worksSchema = z.object({
  title: z.string().meta({ title: "Page heading" }),
  pieces: z.array(z.object({ title: z.string().meta({ title: "Title of the piece" }) }))
});

const EN = normalize(`meta:
  title: "Elfine Sarkissian"
nav:
  works: "Work"
contact:
  heading: "Get in touch"
  email: "hello@elfine.example"
`);

const FR = normalize(`meta:
  title: "Elfine Sarkissian"
nav:
  works: "Travaux"
contact:
  heading: "Me contacter"
  email: "hello@elfine.example"
`);

const WORKS = normalize(`title: "Work"
pieces:
  - title: "Tip of the Tongue"
  - title: "The Weight of Water"
`);

const collections = {
  site: {
    schema: siteSchema,
    dir: "src/content/site",
    label: "Shared — menu, footer & contact",
    entryLabels: { "site.en": "English", "site.fr": "Français" },
    entryUrl: { "site.en": "/", "site.fr": "/fr/" }
  },
  works: {
    schema: worksSchema,
    file: "src/content/works/works.en.yaml",
    label: "Work"
  }
};

const utf8Base64 = (text: string): string => Buffer.from(text, "utf8").toString("base64");

/** Every GitHub request the last search made, so a test can assert on how
    many rather than only on what came back. */
let calls: string[];
let head: string;

beforeEach(() => {
  calls = [];
  head = "commit-one";
  vi.stubGlobal("fetch", async (url: string) => {
    const path = new URL(url).pathname + new URL(url).search;
    calls.push(path);

    /* Any repo answers the freshness question — the cache-key tests need a
       second repository that is reachable and simply has nothing in it. */
    if (path.includes("/commits")) return json([{ sha: head }]);
    /* Only elfine has content, and that asymmetry is the point: a cache that
       ignored the repo would serve her pages to somebody else's site, and this
       is the line that would catch it. */
    if (!path.includes("/elfine-site/")) return json({ message: "Not Found" }, 404);
    if (path.endsWith("/contents/src/content/site")) {
      return json([
        { type: "file", name: "site.en.yaml" },
        { type: "file", name: "site.fr.yaml" },
        { type: "file", name: "README.md" }
      ]);
    }
    if (path.includes("site.en.yaml")) return json({ type: "file", content: utf8Base64(EN), sha: "a" });
    if (path.includes("site.fr.yaml")) return json({ type: "file", content: utf8Base64(FR), sha: "b" });
    if (path.includes("works.en.yaml")) return json({ type: "file", content: utf8Base64(WORKS), sha: "c" });
    return json({ message: "unexpected" }, 404);
  });
});

afterEach(() => vi.unstubAllGlobals());

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("searchSite", () => {
  /* THE ACCEPTANCE TEST OF THE WHOLE STAGE, in miniature. `hello@elfine.example`
     has been on every page of a real client's site in both languages since it
     was built, `.example` can never resolve, and it took a person noticing. A
     search that finds it in *both* locales is a search that works. */
  it("finds hello@elfine.example in both locales", async () => {
    const found = await searchSite(access, collections, "hello@elfine.example");

    expect(found.total).toBe(2);
    expect(found.hits.map((hit) => hit.entry).sort()).toEqual(["site.en", "site.fr"]);
    for (const hit of found.hits) {
      expect(hit.collection).toBe("site");
      expect(hit.path).toBe("contact.email");
      expect(hit.label).toBe("Email");
      expect(hit.snippet?.match).toBe("hello@elfine.example");
      expect(hit.file).toBe(`src/content/${hit.entry.split(".")[0]}/${hit.entry}.yaml`);
    }
    /* And it names the pages the way the picker does, which is the only reason
       "go to that page" is a useful instruction. */
    expect(found.hits.map((hit) => hit.title).sort()).toEqual([
      "Shared — menu, footer & contact — English",
      "Shared — menu, footer & contact — Français"
    ]);
  });

  it("reads every entry of every collection, and says how many", async () => {
    const found = await searchSite(access, collections, "work");
    expect(found.entries).toBe(3);
    expect(found.capped).toBeUndefined();
  });

  it("carries the site's own URL for a page, where the site declared one", async () => {
    const found = await searchSite(access, collections, "hello@elfine.example");
    expect(found.hits.find((hit) => hit.entry === "site.fr")?.url).toBe("/fr/");
    /* And omits it rather than inventing one where the site did not. */
    const works = await searchSite(access, collections, "Tip of the Tongue");
    expect(works.hits[0]?.url).toBeUndefined();
  });

  it("leaves out the page the panel already has open", async () => {
    const all = await searchSite(access, collections, "hello@elfine.example");
    expect(all.total).toBe(2);

    const rest = await searchSite(access, collections, "hello@elfine.example", {
      skip: "site/site.en"
    });
    expect(rest.total).toBe(1);
    expect(rest.hits[0]?.entry).toBe("site.fr");
  });

  it("finds a row inside a repeater and numbers it the way the panel does", async () => {
    const found = await searchSite(access, collections, "Weight of Water");
    expect(found.total).toBe(1);
    expect(found.hits[0]?.path).toBe("pieces[1].title");
    /* The number is on the *trail*, not on the label: a row reads "Pieces —
       Piece 2 — Title of the piece", which is where the second piece sits and
       what the field in it is called. That is what the panel draws, and a
       result naming something an owner cannot see once they get there is the
       failure this asserts against. */
    expect(found.hits[0]?.label).toBe("Title of the piece");
    expect(found.hits[0]?.where).toEqual(["Pieces", "Piece 2"]);
  });

  it("puts label matches ahead of value matches across the whole site", async () => {
    /* "Work" is the label of a field on the works page and the *value* of the
       English nav entry. The field called Work comes first, for the same
       reason it does within one entry. */
    const found = await searchSite(access, collections, "work");
    expect(found.hits[0]?.labelMatch).toBeDefined();
    expect(found.hits.some((hit) => hit.snippet && !hit.labelMatch)).toBe(true);
  });

  it("finds a section's on/off switch by the word the panel draws, not the schema's", async () => {
    const withToggle = {
      page: {
        schema: z.object({
          gallery: z.object({
            visible: z.boolean(),
            heading: z.string().meta({ title: "Gallery heading" })
          })
        }),
        file: "src/content/works/works.en.yaml",
        label: "Page"
      }
    };
    vi.stubGlobal("fetch", async (url: string) => {
      const path = new URL(url).pathname;
      if (path.includes("/commits")) return json([{ sha: head }]);
      return json({
        type: "file",
        content: utf8Base64(normalize(`gallery:\n  visible: true\n  heading: "Photographs"\n`)),
        sha: "d"
      });
    });

    const found = await searchSite(access, withToggle, "Show this section", {
      toggleLabel: "Show this section"
    });
    expect(found.total).toBe(1);
    expect(found.hits[0]?.path).toBe("gallery.visible");
  });

  it("returns nothing for a query that is only spaces, without reading anything", async () => {
    const found = await searchSite(access, collections, "   ");
    expect(found).toEqual({ hits: [], total: 0, entries: 0 });
    expect(calls).toEqual([]);
  });

  it("caps the query rather than folding an unbounded string", async () => {
    /* 200 characters of "x" plus a word that does exist. The tail is cut, so
       the query cannot match — which is the point: nothing here is willing to
       fold a megabyte because a caller sent one. */
    const found = await searchSite(access, collections, `${"x".repeat(200)}hello@elfine.example`);
    expect(found.total).toBe(0);
  });
});

describe("the corpus cache", () => {
  it("re-reads nothing while the branch has not moved", async () => {
    const cache = createCorpusCache();
    await searchSite(access, collections, "work", { cache });
    const first = calls.length;
    expect(first).toBeGreaterThan(1);

    calls = [];
    const again = await searchSite(access, collections, "hello@elfine.example", { cache });
    /* One call: "has anything changed?". Nothing else. */
    expect(calls).toEqual(["/repos/shaahink/elfine-site/commits?per_page=1"]);
    expect(again.total).toBe(2);
  });

  /* THE GUARD THAT MAKES THE CACHE SAFE RATHER THAN MERELY FAST. An owner's
     save is a commit; a cache that survived one would hand back the words they
     have just replaced, and it would look exactly like a working search. */
  it("re-reads everything when the branch moves", async () => {
    const cache = createCorpusCache();
    await searchSite(access, collections, "work", { cache });

    head = "commit-two";
    calls = [];
    await searchSite(access, collections, "work", { cache });
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.some((path) => path.includes("site.en.yaml"))).toBe(true);
  });

  it("keeps two repositories apart", async () => {
    const cache = createCorpusCache();
    await searchSite(access, collections, "work", { cache });
    calls = [];
    /* A second site sharing one warm instance must not read the first one's
       content out of the cache. Its own repo answers 404 here, so a hit would
       show up as content it has no right to. */
    const other = await searchSite({ ...access, repo: "shaahink/nimagiti" }, collections, "work", {
      cache
    });
    expect(other.entries).toBe(0);
    expect(calls.some((path) => path.includes("nimagiti"))).toBe(true);
  });

  it("keeps two branches of one repository apart", async () => {
    const cache = createCorpusCache();
    await searchSite(access, collections, "work", { cache });
    calls = [];
    await searchSite({ ...access, branch: "redesign" }, collections, "work", { cache });
    expect(calls[0]).toBe("/repos/shaahink/elfine-site/commits?sha=redesign&per_page=1");
    expect(calls.length).toBeGreaterThan(1);
  });
});

describe("when part of the site cannot be read", () => {
  it("answers with the entries it could read rather than failing the search", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const path = new URL(url).pathname;
      if (path.includes("/commits")) return json([{ sha: head }]);
      if (path.endsWith("/contents/src/content/site")) {
        return json([
          { type: "file", name: "site.en.yaml" },
          { type: "file", name: "site.fr.yaml" }
        ]);
      }
      if (path.includes("site.en.yaml")) return json({ type: "file", content: utf8Base64(EN), sha: "a" });
      /* The French page is gone and the English one is not. Nineteen pages of
         twenty is an answer; an exception is not. */
      return json({ message: "Not Found" }, 404);
    });

    const found = await searchSite(access, collections, "hello@elfine.example");
    expect(found.total).toBe(1);
    expect(found.entries).toBe(1);
    expect(found.hits[0]?.entry).toBe("site.en");
  });

  it("rejects when the branch itself cannot be reached", async () => {
    vi.stubGlobal("fetch", async () => json({ message: "Bad credentials" }, 401));
    await expect(searchSite(access, collections, "work")).rejects.toThrow(/head/);
  });
});

describe("the count stays honest when the list is capped", () => {
  it("reports every match even though only `limit` travel", async () => {
    const many = normalize(
      `title: "Work"\npieces:\n${Array.from({ length: 40 }, (_, i) => `  - title: "Piece ${i} work"`).join("\n")}\n`
    );
    vi.stubGlobal("fetch", async (url: string) => {
      const path = new URL(url).pathname;
      if (path.includes("/commits")) return json([{ sha: head }]);
      return json({ type: "file", content: utf8Base64(many), sha: "e" });
    });

    const found = await searchSite(
      access,
      { works: { schema: worksSchema, file: "src/content/works/works.en.yaml", label: "Work" } },
      "work",
      { limit: 5 }
    );
    expect(found.hits).toHaveLength(5);
    /* Forty rows whose value says "work", plus the page heading whose value is
       "Work". The number the panel prints is this one, not five — a list of
       five over forty-one matches has hidden thirty-six of them, and saying so
       is the difference between "narrow it down" and "that is all there is". */
    expect(found.total).toBe(41);
  });
});

/* ONE MATCHER, AND THIS IS WHAT SAYS SO. match.ts is a leaf so that the panel
   and the handler can share it; if they ever stopped sharing it, a word that
   found a field on the page in front of the owner would stop finding the same
   field on the page beside it — and nothing else in either suite would
   notice. */
describe("the server and the panel agree", () => {
  it("produces the same spans over the same entry", async () => {
    const fields = formModel(siteSchema);
    const values = readValues(EN);
    const local = searchEntry(fields, values, "hello@elfine");

    const remote = await searchSite(
      access,
      { site: { schema: siteSchema, file: "src/content/site/site.en.yaml", label: "Shared" } },
      "hello@elfine"
    );

    expect(remote.total).toBe(local.total);
    expect(remote.hits[0]?.path).toBe(local.hits[0]?.path);
    expect(remote.hits[0]?.label).toBe(local.hits[0]?.label);
    expect(remote.hits[0]?.snippet).toEqual(local.hits[0]?.snippet);
    expect(remote.hits[0]?.where).toEqual(local.hits[0]?.where);
  });

  /* And the same over the Persian folds, because the site they were built for
     is the one whose panel almost never has the right page open: 21 pages and
     ten articles means the row an owner taps is nearly always an *elsewhere*
     row, served by the handler. A fold that reached only the panel would look
     perfect on the page in front of them and find nothing anywhere else. */
  it("folds a Persian query the same way on both sides", async () => {
    const zwnj = String.fromCharCode(0x200c);
    const joined = "سلول" + zwnj + "های";
    const schema = z.object({
      title: z.string().meta({ title: "عنوان" }),
      body: z.string().meta({ title: "متن" })
    });
    const article = normalize(`title: "جراحی ماستوئید"\nbody: "عفونت در ${joined} ماستوئید"\n`);

    vi.stubGlobal("fetch", async (url: string) => {
      const path = new URL(url).pathname;
      if (path.includes("/commits")) return json([{ sha: head }]);
      return json({ type: "file", content: utf8Base64(article), sha: "f" });
    });

    /* The space spelling, which only the forgiving pass can answer. */
    const query = "سلول های";
    const local = searchEntry(formModel(schema), readValues(article), query);
    const remote = await searchSite(
      access,
      { articles: { schema, file: "src/content/articles/mastoid.yaml", label: "مقاله" } },
      query
    );

    expect(local.total).toBe(1);
    expect(remote.total).toBe(local.total);
    expect(remote.hits[0]?.snippet).toEqual(local.hits[0]?.snippet);
    /* The ZWNJ is still in what the owner is shown — the fold was for the
       comparison, and the snippet is a slice of the file. */
    expect(remote.hits[0]?.snippet?.match).toBe(joined);
  });
});
