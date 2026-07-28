/* Unsaved work, kept across a reload.
   ---------------------------------------------------------------------------
   Inline editing happens on a phone, in a browser that discards background
   tabs whenever it feels like it. An owner who types four sentences into their
   own homepage, switches to Mail to check a name, and comes back to find the
   page reloaded and the sentences gone will not try again. A `beforeunload`
   prompt does not help there: nothing was unloaded on purpose, and iOS does
   not show the prompt anyway.

   So every change is written to sessionStorage as it is made, and offered back
   on the next load. Deliberately session, not local: a draft is meant to
   survive a reload, not to follow someone to a machine they were not sitting
   at.

   Nothing is ever restored silently. A draft is *offered*, because restoring
   changes an owner cannot see (they may be below the fold, on a page they did
   not scroll) would be the editor typing on their behalf.

   The `sha` is what makes this safe. It is the blob the draft was based on, so
   a draft written before someone else's commit can be recognised as stale and
   thrown away rather than replayed over their work. */

import type { Edit } from "./dirty.js";

const PREFIX = "sk-inline-draft:";

export interface Draft {
  /** The blob the edits were based on. */
  sha: string;
  /** Only the fields the owner actually touched, as the server wants them. */
  edits: Edit[];
  /** What each edited element should read, so the page can be put back exactly
      as it was left — `edits` carries coerced values, which for a number field
      is not the string that was in the element. */
  raw: Record<string, string>;
}

export function draftKey(collection: string, entry: string): string {
  return `${PREFIX}${collection}/${entry}`;
}

/** Storage is a parameter so this is testable without a DOM, and so private
    browsing — where every call throws — is handled in exactly one place. */
export interface DraftStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function saveDraft(store: DraftStore, key: string, draft: Draft): void {
  try {
    if (!draft.edits.length) {
      store.removeItem(key);
      return;
    }
    store.setItem(key, JSON.stringify(draft));
  } catch {
    /* Private browsing, or a full quota. The edits are still in memory and
       still saveable; only the safety net is missing, and telling an owner
       about a storage quota would be noise they cannot act on. */
  }
}

export function clearDraft(store: DraftStore, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    /* as above */
  }
}

export type DraftVerdict =
  | { state: "none" }
  /** Usable: written against the blob the page is currently showing. */
  | { state: "usable"; draft: Draft }
  /** Real work, but the file has moved on underneath it. Replaying it would
      overwrite whatever the other edit did, so it is dropped — and the owner
      is told, because silently discarding someone's sentences is worse than
      the reason for discarding them. */
  | { state: "stale"; draft: Draft };

/** What to do with whatever is in storage for this entry. */
export function readDraft(store: DraftStore, key: string, currentSha: string): DraftVerdict {
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return { state: "none" };
  }
  if (!raw) return { state: "none" };

  let draft: Draft;
  try {
    draft = JSON.parse(raw) as Draft;
  } catch {
    clearDraft(store, key);
    return { state: "none" };
  }

  /* A draft with nothing in it is not a draft. This also covers the shape
     changing between kit versions: anything that does not look like a draft
     any more is treated as absent rather than as an error an owner has to
     understand. */
  if (!draft || typeof draft.sha !== "string" || !Array.isArray(draft.edits) || !draft.edits.length) {
    clearDraft(store, key);
    return { state: "none" };
  }

  return draft.sha === currentSha ? { state: "usable", draft } : { state: "stale", draft };
}
