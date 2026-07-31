/* Where a collection's entries live, and what they are called.
   ---------------------------------------------------------------------------
   Four small answers that used to be private to `handler.ts`, moved here in
   A3.2 because the cross-entry search needs every one of them and a second
   copy of "which file is entry `about.fr` in" is a second copy that can be
   wrong on its own. The fleet has paid for that shape twice already —
   `fleet-lib.mjs` exists because three tools had three answers to *who is in
   the fleet* and two of them were wrong.

   Nothing here reaches the network except `entryIds`, and that is one call. */

import { listEntries, type RepoAccess } from "./contents.js";
import type { CollectionConfig } from "./types.js";

/** An entry name becomes a file path, so it is checked rather than trusted:
    anything but a plain name could climb out of the collection's directory. */
export const ENTRY = /^[a-z0-9][a-z0-9._-]*$/i;

/** The entry id of a single-file collection: `src/content/site.yaml` → `site`.
    A collection with a `dir` has many and this is not asked. */
export function entryOf(config: CollectionConfig): string {
  return (config.file ?? "").replace(/^.*\//, "").replace(/\.ya?ml$/, "");
}

/** The repository path holding one entry. */
export function filePath(config: CollectionConfig, entry: string): string {
  if (config.dir) return `${config.dir.replace(/\/+$/, "")}/${entry}.yaml`;
  return config.file as string;
}

/** Every entry id in a collection — one call for a directory, none for a file. */
export async function entryIds(config: CollectionConfig, access: RepoAccess): Promise<string[]> {
  return config.dir ? listEntries(config.dir, access) : [entryOf(config)];
}

/** Which collection and entry a repository path belongs to, or undefined when
    no collection claims it.
    -------------------------------------------------------------------------
    `filePath` read backwards, and it exists for the same reason `filePath`
    does: putting a change back (restore.ts) starts from a list of paths GitHub
    named and has to get from each one to the Zod schema that says whether the
    restored bytes are still valid content. Without this it would be guessing,
    and the one thing a restore must never do is write a document the build
    would then refuse.

    A directory collection claims `${dir}/${entry}.yaml` and nothing deeper: a
    path with another slash in it is in a subdirectory the editor has never
    listed, and treating it as an entry would invent an id that `listEntries`
    disagrees with. */
export function collectionOfPath(
  collections: Record<string, CollectionConfig>,
  path: string
): { name: string; config: CollectionConfig; entry: string } | undefined {
  for (const [name, config] of Object.entries(collections)) {
    if (config.dir) {
      const dir = `${config.dir.replace(/\/+$/, "")}/`;
      if (!path.startsWith(dir)) continue;
      const rest = path.slice(dir.length);
      if (rest.includes("/") || !/\.ya?ml$/.test(rest)) continue;
      const entry = rest.replace(/\.ya?ml$/, "");
      if (!ENTRY.test(entry)) continue;
      return { name, config, entry };
    }
    if (config.file === path) return { name, config, entry: entryOf(config) };
  }
  return undefined;
}

/** Where an entry can be seen on the site, so the panel can offer to go and
    edit it in place. A pattern covers a collection whose URLs are regular
    (`/projects/{entry}.html`); a map covers one whose aren't.

    Only a site-relative path is ever emitted. This value ends up as an href
    the owner taps, so an absolute URL here would be a link off the site
    wearing the editor's clothes — refused rather than trusted, even though
    the only writer is the site's own config. */
export function entryUrl(config: CollectionConfig, id: string): string | undefined {
  const raw =
    typeof config.entryUrl === "string"
      ? config.entryUrl.replace("{entry}", id)
      : config.entryUrl?.[id];
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return undefined;
  return raw;
}

/** What the picker calls a page, and the one place that rule lives.
    -------------------------------------------------------------------------
    The panel writes `"Shared — English"` for a collection with more than one
    entry and just `"Shared"` for one with a single entry (see `chrome` in
    editor/index.ts). A search result naming a page has to use the *same*
    words, because "go to the page called X" is only useful if X is what the
    picker also calls it — and on a bilingual site the entry label is the whole
    safeguard against editing the French page believing it is the English one.

    `count` is how many entries the collection has, which is what decides
    whether the entry needs naming at all. */
export function entryTitle(config: CollectionConfig, id: string, count: number): string {
  const collection = config.label ?? "";
  const entry = config.entryLabels?.[id] ?? id;
  return count > 1 ? `${collection} — ${entry}` : collection;
}
