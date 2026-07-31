/* Searching every page of a site, not just the one that is open.
   ---------------------------------------------------------------------------
   The panel's own search (editor/search.ts) answers instantly and reaches
   exactly one entry — the document it already holds. This is the other half:
   the same query, run over every entry of every collection, on the server,
   because the schemas that turn YAML into labelled fields only exist here.

   ── Why this is not `api/search.ts` ────────────────────────────────────────
   It hangs off the existing content route, like `?home` and `?preview` before
   it. A second `api/` file is a second file in every site repo, and the last
   per-site editor file cost four client-repo commits in an afternoon
   (SCALE.md §9). A site gains nothing for this feature but a version bump —
   which is the bar the editor is judged against.

   ── On demand or an index? Measured, not reasoned ──────────────────────────
   A3.2 timed four ways of getting mosleh-clinic's 24 YAML files (146,346 B)
   out of GitHub, three runs each, against the real repository:

       serial contents API      5,555ms      ← what a `for` loop gets you
       parallel contents API      697ms      ← this
       git/trees + blobs          805ms
       one GraphQL query        1,020ms      (and still two round trips, because
                                              a directory listing is the only
                                              way to learn an entry's name)

   So: parallel, through the same `readFile`/`listEntries` the handler already
   uses — the fastest option is also the one that adds no new API surface.

   And then an index, because 24 files is 24 API calls and an owner types more
   than once. **The index is guarded by the branch's head commit sha**, which
   is what makes it safe rather than merely fast: an owner's save *is* a commit,
   so a moved sha means re-read, and this can never hand back the words they
   have just replaced. That check was measured too — `/commits?per_page=1` is
   258ms against mosleh — so a warm search costs ~250ms and one call instead of
   ~700ms and twenty-four.

   `/commits?per_page=1` rather than `/git/ref/heads/{branch}`, which was
   marginally faster in the measurement, for a reason the clock does not show:
   `access.branch` is optional and usually absent, and this route answers for
   the default branch without being told its name. One call, not two.

   ── The cache is a lazy singleton, and that is not a style preference ──────
   A Worker has no env at module scope. The rate limiter was fixed for exactly
   this and proved by a 429 on request sixteen; `createCorpusCache()` is called
   from inside `createContentHandler`, holds no credential, and is keyed by
   repo and branch so two sites sharing an instance cannot read each other's
   content out of it. */

import { gh } from "../feedback/github.js";
import { searchEntry, type SearchHit } from "../editor/match.js";
import { readFile, type RepoAccess } from "./contents.js";
import { entryIds, entryTitle, entryUrl, filePath } from "./entries.js";
import type { Field } from "./fields.js";
import { formModel } from "./form.js";
import type { CollectionConfig } from "./types.js";
import { readValues } from "./yaml.js";

/** One match on a page the owner does not have open. */
export interface SiteHit extends SearchHit {
  collection: string;
  entry: string;
  /** What the picker calls that page — `entryTitle`, so the two cannot
      disagree about a page's name. */
  title: string;
  /** The file it is in, which is what the panel's footer shows. */
  file: string;
  /** Where that page can be seen, when the site declared it. */
  url?: string;
}

export interface SiteSearch {
  hits: SiteHit[];
  total: number;
  /** How many entries were actually read, so the panel can say what it looked
      through rather than implying it looked everywhere. */
  entries: number;
  /** Set only when the corpus hit `MAX_ENTRIES` and some of the site was not
      searched at all. Never silently true: a search that quietly stopped
      looking is the one failure this feature cannot survive. */
  capped?: boolean;
}

/** One entry, parsed once and kept. */
interface CorpusEntry {
  collection: string;
  entry: string;
  title: string;
  file: string;
  url?: string;
  fields: Field[];
  values: unknown;
}

interface Corpus {
  /** The commit every entry in here was read at. */
  sha: string;
  entries: CorpusEntry[];
  capped: boolean;
}

export interface CorpusCache {
  get(key: string): Corpus | undefined;
  set(key: string, corpus: Corpus): void;
}

/** A ceiling on how much of a repository one search will read.
    -------------------------------------------------------------------------
    mosleh is 24 and it is the biggest site in the fleet by some way, so this
    is not a limit anything here meets — it is the thing that stops a
    mis-configured `dir` pointing at a thousand files and turning one owner's
    keystroke into a thousand API calls. When it bites, `capped` says so and
    the panel prints it. */
const MAX_ENTRIES = 200;

/** How long a query may be. Folded and compared, never stored, never written —
    but an unbounded string is still an unbounded string to fold. */
const MAX_QUERY = 200;

/** How many hits travel back. Higher than the panel's own twenty because these
    are spread across every page and an owner scanning for *which page* wants
    more than one row per page; the total is reported either way. */
const DEFAULT_LIMIT = 30;

export function createCorpusCache(): CorpusCache {
  const held = new Map<string, Corpus>();
  return {
    get: (key) => held.get(key),
    set: (key, corpus) => {
      held.set(key, corpus);
    }
  };
}

/** The commit the search should be reading at. */
async function headSha(access: RepoAccess): Promise<string> {
  const query = access.branch ? `?sha=${encodeURIComponent(access.branch)}&per_page=1` : "?per_page=1";
  const result = await gh(`/repos/${access.repo}/commits${query}`, {
    token: access.token,
    userAgent: access.userAgent
  });
  if (!result.ok || !Array.isArray(result.data) || typeof result.data[0]?.sha !== "string") {
    throw new Error(`head: ${result.status} ${result.text}`);
  }
  return result.data[0].sha as string;
}

/** Every editable entry of every collection, read in parallel and parsed.

    A single entry that fails to read is dropped rather than failing the
    search, and it is counted out of `entries` so the number stays honest — an
    owner searching twenty-three of their twenty-four pages should get the
    twenty-three, not an error about the one. A failure to reach GitHub at all
    surfaces as a rejection, because that is not a partial answer. */
async function readCorpus(
  access: RepoAccess,
  collections: Record<string, CollectionConfig>,
  sha: string
): Promise<Corpus> {
  /* The directory listings first, all at once: they are what says how many
     entries a collection has, which `entryTitle` needs before anything is
     read. */
  const names = Object.keys(collections);
  const listed = await Promise.all(
    names.map((name) => entryIds(collections[name] as CollectionConfig, access))
  );

  const wanted: Array<{ name: string; config: CollectionConfig; id: string; count: number }> = [];
  let capped = false;
  for (const [index, name] of names.entries()) {
    const config = collections[name] as CollectionConfig;
    const ids = listed[index] ?? [];
    for (const id of ids) {
      if (wanted.length >= MAX_ENTRIES) {
        capped = true;
        break;
      }
      wanted.push({ name, config, id, count: ids.length });
    }
  }

  /* The form model is per collection, not per entry, and building it walks a
     Zod schema — so it is built once here rather than once per article. */
  const models = new Map<string, Field[]>();
  for (const { name, config } of wanted) {
    if (!models.has(name)) {
      models.set(name, formModel(config.schema, { ...(config.omit ? { omit: config.omit } : {}) }));
    }
  }

  const read = await Promise.all(
    wanted.map(async ({ name, config, id, count }): Promise<CorpusEntry | null> => {
      const file = filePath(config, id);
      let contents;
      try {
        contents = await readFile(file, access);
      } catch (error) {
        console.error("cms search: couldn't read", file, (error as Error).message);
        return null;
      }
      if (!contents) return null;
      let values: unknown;
      try {
        values = readValues(contents.text);
      } catch (error) {
        /* A file the build would already be failing on. Skipped rather than
           thrown: the other twenty-three are still searchable and this is a
           read. */
        console.error("cms search: couldn't parse", file, (error as Error).message);
        return null;
      }
      const url = entryUrl(config, id);
      return {
        collection: name,
        entry: id,
        title: entryTitle(config, id, count),
        file,
        ...(url ? { url } : {}),
        fields: models.get(name) as Field[],
        values
      };
    })
  );

  return { sha, entries: read.filter((entry): entry is CorpusEntry => entry !== null), capped };
}

export interface SearchSiteOptions {
  /** The picker's own `collection/entry` value for the page already open. Its
      hits are the panel's instant list and are left out of this one, so an
      owner is never offered two routes to one field — one of which reloads the
      page they are already on. */
  skip?: string | undefined;
  /** What the panel calls a section's on/off switch, so a search for the word
      an owner can *see* finds it. The panel's string table holds it and the
      server has no string table; passing it is one query parameter and the
      alternative is a second copy of the panel's copy. */
  toggleLabel?: string | undefined;
  limit?: number | undefined;
  cache?: CorpusCache | undefined;
}

/** Every field on the site matching `query`, minus the page already open. */
export async function searchSite(
  access: RepoAccess,
  collections: Record<string, CollectionConfig>,
  query: string,
  options: SearchSiteOptions = {}
): Promise<SiteSearch> {
  const needle = query.slice(0, MAX_QUERY);
  if (!needle.trim()) return { hits: [], total: 0, entries: 0 };

  const key = `${access.repo}@${access.branch ?? ""}`;
  const sha = await headSha(access);
  let corpus = options.cache?.get(key);
  if (!corpus || corpus.sha !== sha) {
    corpus = await readCorpus(access, collections, sha);
    options.cache?.set(key, corpus);
  }

  const limit = options.limit ?? DEFAULT_LIMIT;
  const hits: SiteHit[] = [];
  let total = 0;
  for (const entry of corpus.entries) {
    if (options.skip && `${entry.collection}/${entry.entry}` === options.skip) continue;
    /* Twice the whole list's cap, per entry. Enough that one page can fill the
       answer on its own — which is what happens when the match really is all
       on one page — and bounded, so a single letter across twenty-four pages
       builds a few dozen snippets rather than several thousand it would then
       throw away. `found.total` is the true count either way, so nothing here
       makes the number the panel prints less honest. */
    const found = searchEntry(entry.fields, entry.values, needle, {
      ...(options.toggleLabel ? { toggleLabel: options.toggleLabel } : {}),
      limit: limit * 2
    });
    total += found.total;
    for (const hit of found.hits) {
      hits.push({
        ...hit,
        collection: entry.collection,
        entry: entry.entry,
        title: entry.title,
        file: entry.file,
        ...(entry.url ? { url: entry.url } : {})
      });
    }
  }

  /* Label matches first across the whole site, then value matches, then the
     order the collections were declared in — the same rule `searchEntry` uses
     within one entry, applied one level up, so the two lists in the panel are
     ordered by the same idea. */
  hits.sort((a, b) => Number(Boolean(b.labelMatch)) - Number(Boolean(a.labelMatch)));

  return {
    hits: hits.slice(0, limit),
    total,
    entries: corpus.entries.length,
    ...(corpus.capped ? { capped: true } : {})
  };
}
