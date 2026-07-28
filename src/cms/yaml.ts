/* Reading and rewriting content YAML without wrecking the diff.
   ---------------------------------------------------------------------------
   Content is hand-authored: block scalars, deliberate quoting, Persian and
   Arabic text, comments that explain the content model. Shahin reviewing owner
   edits as readable diffs is the safety net under this whole feature, so a
   one-field edit has to produce a one-hunk commit. A naive dump would rewrite
   every file on every save and make that impossible.

   Three approaches were measured against Bez's real home.yaml (session 7's
   ground truth). Round-tripping the hand-authored file refolds long quoted
   lines, because no single lineWidth reproduces both its ~78-col block scalars
   and its ~110-col quoted strings. Splicing byte ranges is exact for quoted
   scalars but corrupts block scalars outright. What works is normalising once,
   in its own reviewed commit: `toString()` is then a fixed point, and every
   edit afterwards is minimal. Comments survive throughout.

   `yaml` is the kit's first real dependency. It is pure JS with no Node
   built-ins, so §3.4 holds and the Cloudflare swap stays a one-liner. */

import { isScalar, parseDocument, type Document } from "yaml";

/** Explicit rather than defaulted, so a `yaml` minor bump can never silently
    move the fixed point and reflow every content file in the fleet. */
const STRINGIFY = { lineWidth: 80 } as const;

export interface Edit {
  /** A concrete path — `hero.tagline`, `hero.slides[0].alt`. The form model's
      `[]` templates are not paths and are rejected. */
  path: string;
  value: unknown;
}

/** The one-time reflow. Idempotent: `normalize(normalize(x)) === normalize(x)`,
    asserted against a real fixture in the tests. */
export function normalize(source: string): string {
  return parse(source).toString(STRINGIFY);
}

/** The parsed content, for validation and for prefilling the form. */
export function readValues(source: string): unknown {
  return parse(source).toJS();
}

/** The edited source. Preserves each scalar's existing style, so a folded
    block stays folded and a quoted string stays quoted — which is what keeps
    the diff to the lines that actually changed. */
export function applyEdits(source: string, edits: Edit[]): string {
  if (!edits.length) return source;

  /* Try in-place scalar mutation first: it keeps `>-` and the quoting style.
     If that can't reproduce a value exactly — a folded scalar cannot hold
     every string — fall back to letting `yaml` choose the style itself, and
     only then give up. Content that doesn't say what the owner typed must
     never reach a commit. */
  for (const preserveStyle of [true, false]) {
    const doc = parse(source);
    for (const edit of edits) {
      const keyPath = parsePath(edit.path);
      const existing = preserveStyle ? doc.getIn(keyPath, true) : undefined;
      if (typeof edit.value === "string" && isScalar(existing) && typeof existing.value === "string") {
        existing.value = edit.value;
      } else {
        doc.setIn(keyPath, edit.value);
      }
    }
    const output = doc.toString(STRINGIFY);
    if (roundTrips(output, edits)) return output;
  }

  throw new Error("edit could not be written back to YAML exactly");
}

/** `hero.slides[0].alt` → `["hero", "slides", 0, "alt"]`. */
export function parsePath(path: string): Array<string | number> {
  const segments = path.split(".");
  const out: Array<string | number> = [];
  for (const segment of segments) {
    const match = /^([^[\]]*)((?:\[\d+\])*)$/.exec(segment);
    if (!match) throw new Error(`bad path segment: ${segment}`);
    const name = match[1] ?? "";
    if (name) out.push(name);
    for (const index of (match[2] ?? "").matchAll(/\[(\d+)\]/g)) {
      out.push(Number(index[1]));
    }
  }
  if (!out.length) throw new Error(`empty path: ${path}`);
  return out;
}

function parse(source: string): Document {
  const doc = parseDocument(source);
  if (doc.errors.length) {
    throw new Error(`content is not valid YAML: ${doc.errors[0]?.message ?? "unknown"}`);
  }
  return doc;
}

/** Did every edited value survive the trip back through the parser? */
function roundTrips(output: string, edits: Edit[]): boolean {
  let doc: Document;
  try {
    doc = parse(output);
  } catch {
    return false;
  }
  return edits.every((edit) => {
    const actual = doc.getIn(parsePath(edit.path));
    /* Structural values compare by shape; scalars compare directly. */
    return typeof edit.value === "object" && edit.value !== null
      ? JSON.stringify(actual) === JSON.stringify(edit.value)
      : actual === edit.value;
  });
}
