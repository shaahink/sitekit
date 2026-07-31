/* Putting a change back.
   ---------------------------------------------------------------------------
   The editor has promised this since 7.7, on the first screen every owner
   sees, in three languages: *"anything can be put back the way it was — just
   ask."* Session 23's survey measured what was behind the promise and found
   `restoreControls = 0` on a live client's panel. Undo existed; its
   implementation was a person, and it was the one promise in the product whose
   fulfilment did not scale with the number of sites.

   So: a change in the owner's own list, put back, as a commit like any other.

   **It is not a `git revert` and it deliberately cannot be.** A revert is
   defined over a whole tree — code, configuration, the lot — and this is an
   editor for content. What it does instead is narrow and stateable in one
   sentence: *every content file this change touched goes back to the bytes it
   held immediately before it.* Nothing outside the collections is read and
   nothing outside them is written, so a commit that changed a layout and a
   paragraph gives the paragraph back and leaves the layout alone.

   Five refusals, each because the alternative is worse than not offering it:

     - **a sha the change list did not show.** The panel draws five rows and
       this accepts those five. It is not a permissions check — the gate above
       already decided this person may edit this site — it is the thing that
       keeps the button honest: an editor that can put back "this change" and
       a list that shows the changes must be talking about the same set.
     - **a commit with no parent.** There is no "how it was before" the first
       commit in a repository.
     - **a content file that was added, removed or renamed.** Putting an
       addition back is deleting an entry, and putting a removal back is
       creating one. Both are gap 3 of the survey, which is Out for the round
       with its reasons written: a slug, a place in the nav, a sitemap entry
       and a translation are decisions the site's structure makes, not the
       editor. Refusing loudly is the honest half of that verdict.
     - **a file something has changed since.** Checked by reading the path at
       the commit and at the branch head and comparing: if they differ,
       somebody saved after this change and putting it back would silently
       throw their work away. The message says to put the newest one back
       first, which composes — two restores, in order, do reach the same place.
     - **content the schema would now refuse.** The bytes are re-validated
       against the same Zod schema the build uses before anything is written.
       Content is older than the schema it is being restored under, and a
       "put it back" that puts back a broken build is the single worst thing
       this button could do.

   And one thing it does *not* do, which is as deliberate: it never
   re-serialises. The parent's bytes are written back exactly as they were, so
   Persian digits, ZWNJ and every YAML quoting choice survive by not being
   touched — the normalisation trap (CLAUDE.md, RTL) cannot reach a path that
   does no parsing on the way out.

   Web-standard throughout: `fetch` and JSON through `gh`, nothing host-shaped.
   §3.4 holds. */

import { gh } from "../feedback/github.js";
import { readFile, type RepoAccess } from "./contents.js";
import { collectionOfPath } from "./entries.js";
import { recentChanges } from "./history.js";
import { contentPaths } from "./home.js";
import { commitFiles } from "./tree.js";
import type { CollectionConfig } from "./types.js";
import { readValues } from "./yaml.js";

/** A refusal an owner is allowed to read. Everything else is a 502 and a line
    in the function log: this class is the boundary between "you cannot do that,
    and here is why" and "something broke". */
export class RestoreError extends Error {}

export interface Restored {
  /** False when every file already holds what the restore would write —
      pressing the button twice, or a change somebody has already undone by
      hand. Nothing is committed, so nothing is deployed. */
  changed: boolean;
  /** The commit, when one was made. */
  commit?: string;
  /** The content files actually put back, repository-relative. Empty when
      nothing needed moving; a file the change touched and that already holds
      the older version is not in here, because it was not written. */
  files: string[];
}

export interface PutBackOptions {
  who: { name: string; email: string };
  /** How far back the change list reaches — the same number the panel drew.
      Five, from `ownerHome`. */
  limit?: number;
}

/** Put one change back. Throws `RestoreError` with a sentence for the owner. */
export async function putBack(
  access: RepoAccess,
  collections: Record<string, CollectionConfig>,
  sha: string,
  options: PutBackOptions
): Promise<Restored> {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new RestoreError("That isn't a change this editor knows.");

  const paths = contentPaths(collections);
  const shown = await recentChanges(access, paths, options.limit ?? 5);
  const change = shown.find((entry) => entry.sha === sha);
  if (!change) {
    /* Deliberately the same sentence as a malformed sha. The list is what the
       owner can act on; whether a sha outside it exists at all is not a
       question this route should answer about a private repository. */
    throw new RestoreError("That isn't a change this editor knows.");
  }

  const commit = await call(`/repos/${access.repo}/commits/${sha}`, access);
  const parent = (commit.parents as Array<{ sha?: string }> | undefined)?.[0]?.sha;
  if (!parent) throw new RestoreError("There's nothing before this change to put back.");

  /* The comparison rather than the commit's own `files`, and this is the case
     that decides it: elfine's whole change list is one merge commit — a
     redesign that reached her live site through a tool rather than a decision
     (session 23, gap 1). GitHub reports a merge's `files` as a combined diff,
     which for a clean merge is empty; `compare` against the first parent
     answers what the change actually did to the branch it landed on, for a
     merge and an ordinary commit alike. GitHub makes the base branch a merge
     commit's first parent, so `parents[0]` is "main before this landed". */
  const comparison = await call(
    `/repos/${access.repo}/compare/${parent}...${sha}`,
    access
  );
  const touched = (comparison.files as Array<{ filename?: string; status?: string }> | undefined) ?? [];

  const wanted: Array<{ path: string; config: CollectionConfig; status: string }> = [];
  for (const file of touched) {
    const path = file.filename;
    if (!path) continue;
    const owner = collectionOfPath(collections, path);
    if (!owner) continue;
    wanted.push({ path, config: owner.config, status: file.status ?? "modified" });
  }

  if (!wanted.length) {
    /* A code commit, a dependency bump, or a redesign that moved templates and
       left the words alone. The list is filtered by content path so these do
       appear in it — `homeChangeByUs` exists for exactly them — and the honest
       answer is that there is nothing here this editor owns. */
    throw new RestoreError("This change didn't touch any of your words, so there's nothing to put back.");
  }

  const structural = wanted.filter((file) => file.status !== "modified");
  if (structural.length) {
    throw new RestoreError(
      `This change added or removed ${count(structural.length, "page")}, and putting a page back is ` +
        "more than this editor does on its own — ask for that one."
    );
  }

  /* Three reads per file and every one of them earns its place: the parent's
     bytes are what gets written, the commit's are what the branch is checked
     against, and the head's are the current state the answer is relative to. */
  const files: Array<{ path: string; text: string; sha: string }> = [];
  for (const file of wanted) {
    const [before, after, now] = await Promise.all([
      readFile(file.path, access, { ref: parent }),
      readFile(file.path, access, { ref: sha }),
      readFile(file.path, access)
    ]);
    if (!before || !after || !now) {
      throw new RestoreError("Couldn't read how that page was before the change.");
    }

    /* Already back, and asked *before* the conflict check on purpose. Pressing
       the button twice, or pressing it on a change somebody has already undone
       by hand, both arrive here — and both are "that is how your site already
       is", which is a true and calm answer. Checking the conflict first would
       call the same state "somebody edited this since", which is technically
       true, unhelpful, and would leave an owner with no way forward. */
    if (before.text === now.text) continue;

    if (now.text !== after.text) {
      throw new RestoreError(
        "Something has changed on this site since then. Put the newest change back first."
      );
    }

    const parsed = file.config.schema.safeParse(readValues(before.text));
    if (!parsed.success) {
      /* The one refusal that is about time rather than about the owner: the
         schema has moved since these bytes were written, so the version being
         asked for is one this site can no longer build. */
      throw new RestoreError(
        "The older version of that page no longer fits this site's content model, so putting it back " +
          "would break the site — ask for that one."
      );
    }

    files.push({ path: file.path, text: before.text, sha: now.sha });
  }

  if (!files.length) {
    /* Not an error. Nothing to write costs nothing and says so — an empty
       commit here would be a production deploy for no change at all, out of a
       rolling budget six other sites are drawing on. */
    return { changed: false, files: [] };
  }

  const written = await commitFiles(
    files.map((file) => ({ path: file.path, text: file.text })),
    {
      message: restoreMessage(files.map((file) => file.path), sha, options.who),
      /* Every path, not just the first. The branch cannot have moved under a
         restore without one of these blob shas moving with it, and a
         multi-file restore is the common case on a bilingual site. */
      expect: files.map((file) => ({ path: file.path, sha: file.sha }))
    },
    access
  );

  return { changed: true, commit: written.commit, files: files.map((file) => file.path) };
}

/** Readable in `git log` without opening the diff, parsed back by history.ts
    so the panel can say what the row is, and naming the human even though the
    commit is authored by the App — the same three jobs `commitMessage` does for
    a save, in the same shape. */
export function restoreMessage(paths: string[], sha: string, who: { name: string; email: string }): string {
  const file = (paths[0] ?? "").replace(/^.*\//, "");
  const more = paths.length > 1 ? ` and ${paths.length - 1} more` : "";
  const subject =
    paths.length > 1
      ? `Put ${file}${more} back to how they were before ${sha.slice(0, 7)}`
      : `Put ${file} back to how it was before ${sha.slice(0, 7)}`;
  return `${subject}\n\nChanged by ${who.name} <${who.email}> through the site editor.`;
}

async function call(path: string, access: RepoAccess): Promise<any> {
  const result = await gh(path, { token: access.token, userAgent: access.userAgent });
  if (!result.ok) throw new Error(`${path}: ${result.status} ${result.text.slice(0, 120)}`);
  return result.data;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
