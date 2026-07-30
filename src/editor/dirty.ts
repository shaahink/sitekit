/* What the owner has actually touched.
   ---------------------------------------------------------------------------
   Only touched fields travel to the server. The server applies them to its
   own freshly-read copy of the file, so a field nobody looked at can never be
   rewritten by a stale form — which is what makes a one-line diff a property
   of the design rather than a hope.

   Originals are kept so that typing a value back un-marks the field, and so
   that a *second* edit in the same session works: after a save the committed
   values become the new originals. Without that, reverting an edit through
   the editor is impossible without reloading the page — which is exactly the
   round trip the pilot has to be able to do twice. */

export interface Edit {
  path: string;
  value: unknown;
}

interface Change {
  /** What the control holds — compared against the original. */
  raw: string | boolean;
  /** What the schema means by it — sent to the server. */
  value: unknown;
}

export class Dirty {
  private readonly originals = new Map<string, string | boolean>();
  private readonly changes = new Map<string, Change>();
  /** Arrays whose *shape* has changed — a row added, removed or moved.
      Keyed by the array's path, holding the JSON it started as. */
  private readonly lists = new Map<string, string>();
  private readonly listChanges = new Map<string, unknown[]>();

  /** Remember what a control held when it was rendered. */
  track(path: string, original: string | boolean): void {
    this.originals.set(path, original);
  }

  /* --- lists ------------------------------------------------------------
     Adding, removing or moving a row cannot be expressed as a change to one
     path: every row after it shifts, so `slides[1].alt` now names a different
     photograph's caption. The array goes whole instead, and every scalar edit
     underneath it is folded in rather than sent beside it — two edits that
     disagree about what `slides[1]` is would apply in map order, which is not
     a thing to leave to chance in somebody's content.

     The cost is a wider diff for a reorder, and it is the honest one: the rows
     really did move. Content is normalised, so the array comes back in exactly
     the shape `npm run content` would have written, and each site's CI still
     passes. */

  /** Remember an array's shape when it was rendered. */
  trackList(path: string, original: unknown[]): void {
    this.lists.set(path, JSON.stringify(original));
  }

  /** Record an array's shape now. Returns whether it differs from the shape it
      started as — which is also what un-records it, so moving a row down and
      back up leaves nothing to save. That is safe precisely because an array
      identical to its original has identical scalars inside it too. */
  updateList(path: string, rows: unknown[]): boolean {
    if (JSON.stringify(rows) === this.lists.get(path)) {
      this.listChanges.delete(path);
      return false;
    }
    this.listChanges.set(path, rows);
    return true;
  }

  /** Is this path inside an array that is being sent whole? */
  private supersededBy(path: string): boolean {
    for (const listPath of this.listChanges.keys()) {
      if (path.startsWith(`${listPath}[`)) return true;
    }
    return false;
  }

  /** Record what a control holds now. Returns whether the field differs from
      its original, which is what the rendering marks. */
  update(path: string, raw: string | boolean, value: unknown): boolean {
    if (raw === this.originals.get(path)) {
      this.changes.delete(path);
      return false;
    }
    this.changes.set(path, { raw, value });
    return true;
  }

  has(path: string): boolean {
    return this.changes.has(path);
  }

  /** Has the owner's own session made this path what it is?
      -----------------------------------------------------------------------
      Wider than `has` by exactly one case, and the case matters: a field inside
      a row that was added, removed or moved is not in `changes` — `clearUnder`
      drops those on a redraw and the array travels whole — yet a row an owner
      added this minute is theirs in every sense.

      F8 (§2.6) is the caller. A required field left empty is only worth holding
      Save over if *this* session emptied it: a value that was already blank when
      the panel opened is the site builder's oversight, and refusing to save
      anything until an owner fills in a field they have never seen would lock
      them out of fixing the typo they came for. So the guard asks this rather
      than asking whether the field is empty. */
  touched(path: string): boolean {
    return this.changes.has(path) || this.supersededBy(path);
  }

  /** What the owner would be told they are saving. A reordered gallery counts
      once, not once per row that moved and once per caption that came with
      it — "Save 14 changes" for one drag is a sentence that makes an owner
      stop and wonder what else they did. */
  get size(): number {
    let n = this.listChanges.size;
    for (const path of this.changes.keys()) if (!this.supersededBy(path)) n++;
    return n;
  }

  edits(): Edit[] {
    const out: Edit[] = [...this.listChanges].map(([path, rows]) => ({ path, value: rows }));
    for (const [path, change] of this.changes) {
      if (!this.supersededBy(path)) out.push({ path, value: change.value });
    }
    return out;
  }

  /** After a successful commit: what was saved is now what the file holds. */
  settle(): void {
    for (const [path, change] of this.changes) this.originals.set(path, change.raw);
    this.changes.clear();
    for (const [path, rows] of this.listChanges) this.lists.set(path, JSON.stringify(rows));
    this.listChanges.clear();
  }

  /** Forget every scalar change inside an array that is being redrawn.

      A redraw happens because rows moved, so the controls underneath are about
      to be re-tracked against different values and the changes recorded against
      the old positions no longer describe anything. They are folded into the
      array's own edit either way; dropping them keeps `size` honest and stops a
      row that was edited, moved, and moved back from leaving a no-op edit
      behind. */
  clearUnder(path: string): void {
    for (const key of [...this.changes.keys()]) {
      if (key.startsWith(`${path}[`)) this.changes.delete(key);
    }
  }

  /** Loading a different entry — nothing carries over. */
  reset(): void {
    this.originals.clear();
    this.changes.clear();
    this.lists.clear();
    this.listChanges.clear();
  }
}
