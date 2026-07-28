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

  /** Remember what a control held when it was rendered. */
  track(path: string, original: string | boolean): void {
    this.originals.set(path, original);
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

  get size(): number {
    return this.changes.size;
  }

  edits(): Edit[] {
    return [...this.changes].map(([path, change]) => ({ path, value: change.value }));
  }

  /** After a successful commit: what was saved is now what the file holds. */
  settle(): void {
    for (const [path, change] of this.changes) this.originals.set(path, change.raw);
    this.changes.clear();
  }

  /** Loading a different entry — nothing carries over. */
  reset(): void {
    this.originals.clear();
    this.changes.clear();
  }
}
