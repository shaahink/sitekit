/* Reading and reshaping the form model. No DOM here — these are the parts of
   the panel that can be unit-tested, and they are tested (test/editor.test.ts).

   The rest of the panel is DOM construction, verified by browser passes the
   way the widget's is. Keeping the arithmetic out of it is what makes that a
   reasonable division rather than an excuse. */

import type { Field } from "../cms/fields.js";

/** `hero.slides[0].alt` → the value at that path in the parsed document, or
    `undefined` if any step of the way isn't there. A malformed segment reads
    as absent rather than as the parent, which is the safer wrong answer: a
    missing field renders empty, where a parent object would render as
    `[object Object]` and then be saved. */
export function valueAt(values: unknown, path: string): unknown {
  let current: unknown = values;
  for (const segment of path.split(".")) {
    const match = /^([^[\]]*)((?:\[\d+\])*)$/.exec(segment);
    if (!match) return undefined;
    const name = match[1] ?? "";
    const indices = match[2] ?? "";
    if (name) current = step(current, name);
    for (const [, index] of indices.matchAll(/\[(\d+)\]/g)) current = step(current, Number(index));
  }
  return current;
}

function step(value: unknown, key: string | number): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object") return undefined;
  return (value as Record<string | number, unknown>)[key];
}

/** Deep-copy a field subtree with its path prefix pointed somewhere real.

    The model describes one array row as a template — `slides[].alt`. Point it
    at a concrete index and the rest of the walk is the same as anywhere else,
    which is why repeaters need no special case beyond this. */
export function retarget(field: Field, from: string, to: string): Field {
  const path = field.path.startsWith(from) ? to + field.path.slice(from.length) : field.path;
  if (field.kind === "group") {
    return { ...field, path, fields: field.fields.map((child) => retarget(child, from, to)) };
  }
  if (field.kind === "array") {
    return { ...field, path, item: retarget(field.item, from, to) };
  }
  return { ...field, path };
}

/** The form only ever holds strings and checked-ness; the schema says what
    they mean. An emptied number becomes null rather than 0 — the owner
    clearing a field means "nothing", and letting Zod reject it is more honest
    than inventing a zero. */
export function coerce(field: Field, raw: string | boolean): unknown {
  if (field.kind === "boolean") return Boolean(raw);
  if (field.kind === "number") return raw === "" ? null : Number(raw);
  if (field.kind === "select") {
    const match = field.options.find((option) => String(option.value) === raw);
    return match ? match.value : raw;
  }
  return raw;
}

/** "1 change" / "2 changes", with both words supplied so it can be
    translated. English-shaped pluralisation, which is as far as the panel's
    copy needs to go today. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A path that is safe in an id attribute and a CSS selector. */
export function fieldId(path: string): string {
  return `f-${path.replace(/[^a-z0-9]+/gi, "-")}`;
}

/** `hero.slides[0].alt` → `hero.slides[].alt`, the shape the form model uses
    for array items. Concrete indices are what a page annotation carries; the
    model only ever describes one row. */
export function templateOf(path: string): string {
  return path.replace(/\[\d+\]/g, "[]");
}

/** The descriptor for a concrete path, or undefined if the model has none.

    Inline editing needs this where the panel does not: the panel renders the
    model and therefore already holds each field, while an inline annotation
    arrives as a bare string on someone's `<h1>` and has to be looked up. What
    it is looked up *for* is the human label — an owner should be told they are
    editing "Tagline", not `hero.tagline` — and the field kind, which decides
    whether the value can be typed into a paragraph at all. */
export function findField(fields: Field[], path: string): Field | undefined {
  const wanted = templateOf(path);
  for (const field of fields) {
    if (field.path === wanted) return field;
    if (field.kind === "group") {
      const hit = findField(field.fields, path);
      if (hit) return hit;
    }
    if (field.kind === "array") {
      const hit = findField([field.item], path);
      if (hit) return hit;
    }
  }
  return undefined;
}
