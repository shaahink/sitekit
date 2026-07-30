/* Reading and reshaping the form model. No DOM here — these are the parts of
   the panel that can be unit-tested, and they are tested (test/editor.test.ts).

   The rest of the panel is DOM construction, verified by browser passes the
   way the widget's is. Keeping the arithmetic out of it is what makes that a
   reasonable division rather than an excuse. */

import type { BooleanField, Field } from "../cms/fields.js";

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

/** The reverse: put a value where `valueAt` would read it from.

    The panel keeps the document it loaded and writes every control's value
    back into it as it is typed. That copy is what a repeater sends when rows
    move — an array cannot be described by a change to one path, so it goes
    whole, and it has to go whole *including* whatever was typed into it since
    it loaded.

    Missing steps are created, because adding the first row of an empty list
    means writing an array that was not in the file. Nothing is created past a
    step that exists and is the wrong shape: a path that disagrees with the
    document is a fault in the caller, and overwriting a string with an object
    to satisfy it would turn that into lost content. */
export function writeAt(values: unknown, path: string, value: unknown): boolean {
  const steps = pathSteps(path);
  const last = steps.pop();
  if (last === undefined) return false;

  let current: unknown = values;
  for (const [depth, key] of steps.entries()) {
    if (current === null || typeof current !== "object") return false;
    const holder = current as Record<string | number, unknown>;
    if (holder[key] === null || holder[key] === undefined) {
      /* What to create is decided by the *next* step, not this one: a numeric
         step means the thing being created is a list, and a named one means it
         is an object. Reading this off the current key instead is the classic
         way to end up with `slides` as an object with a key called "0". */
      holder[key] = typeof (steps[depth + 1] ?? last) === "number" ? [] : {};
    }
    current = holder[key];
  }
  if (current === null || typeof current !== "object") return false;
  (current as Record<string | number, unknown>)[last] = value;
  return true;
}

function pathSteps(path: string): Array<string | number> {
  const out: Array<string | number> = [];
  for (const segment of path.split(".")) {
    const match = /^([^[\]]*)((?:\[\d+\])*)$/.exec(segment);
    if (!match) return [];
    const name = match[1] ?? "";
    if (name) out.push(name);
    for (const [, index] of (match[2] ?? "").matchAll(/\[(\d+)\]/g)) out.push(Number(index));
  }
  return out;
}

/** Deep-copy a field subtree with its path prefix pointed somewhere real.

    The model describes one array row as a template — `slides[].alt`. Point it
    at a concrete index and the rest of the walk is the same as anywhere else,
    which is why repeaters need no special case beyond this. */
export function retarget(field: Field, from: string, to: string): Field {
  const point = (path: string): string => (path.startsWith(from) ? to + path.slice(from.length) : path);
  const path = point(field.path);

  if (field.kind === "group") {
    return {
      ...field,
      path,
      fields: field.fields.map((child) => retarget(child, from, to)),
      /* The section's switch is not in `fields` — it was lifted out so the
         panel could draw it at the head of the box — so it has to be pointed
         at this row by hand. Missed, a list of hideable rows would give every
         one of them the same switch, writing `rooms[].visible`. */
      ...(field.toggle ? { toggle: retarget(field.toggle, from, to) as BooleanField } : {})
    };
  }
  if (field.kind === "array") {
    return { ...field, path, item: retarget(field.item, from, to) };
  }
  /* Same again, and worse if missed: a picture's `w`, `h` and `alt` are
     sibling *paths* rather than fields, because they are usually omitted from
     the form and the picker still has to write them. Left as templates they
     would send `pieces[].w` as an edit — a path no document has. */
  if (field.kind === "image") {
    return {
      ...field,
      path,
      ...(field.widthPath ? { widthPath: point(field.widthPath) } : {}),
      ...(field.heightPath ? { heightPath: point(field.heightPath) } : {}),
      ...(field.altPath ? { altPath: point(field.altPath) } : {})
    };
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
    copy needs to go today — and Persian needs less, not more: it does not
    pluralise a noun after a numeral, so its table gives the same word twice
    and this picks it either way.

    `digits` is how the number is written. It defaults to `String`, so a caller
    that has no locale to hand still gets a sentence rather than nothing; the
    editor passes `digitsFor(lang)`, because "2 تغییر" is a half-translation
    and reads worse than the English it replaced. */
export function plural(
  n: number,
  one: string,
  many: string,
  digits: (n: number) => string = String
): string {
  return `${digits(n)} ${n === 1 ? one : many}`;
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
/** Every template path this model can legitimately be asked to save.

    `findField` is not enough on its own, and the difference is the whole reason
    this exists: two kinds of savable path are deliberately *not* fields.

    A group's on/off switch is lifted out of `fields` into `toggle` by
    form.ts, so `sections[].visible` — the 0.9.0 feature — is unreachable by a
    walk over `fields`. And a picture's `w`, `h` and `alt` are sibling *paths*
    rather than fields, usually omitted from the form entirely, because the
    picker writes them and an owner has no business typing them.

    Guard a save on `findField` alone and both of those become refusals: an
    owner could not turn a section off, and the picker could not commit a
    photograph's dimensions. Measured against the fleet's own schemas, not
    reasoned about — see cms.test.ts. */
export function savablePaths(fields: Field[]): Set<string> {
  const out = new Set<string>();
  const walk = (field: Field): void => {
    out.add(field.path);
    if (field.kind === "group") {
      if (field.toggle) out.add(field.toggle.path);
      for (const child of field.fields) walk(child);
      return;
    }
    /* The array's own path is savable — a row moving, added or removed cannot
       be expressed as a change to one path, so the array goes whole. See
       dirty.ts. */
    if (field.kind === "array") {
      walk(field.item);
      return;
    }
    if (field.kind === "image") {
      for (const path of [field.widthPath, field.heightPath, field.altPath]) {
        if (path) out.add(path);
      }
    }
  };
  for (const field of fields) walk(field);
  return out;
}

/** Which required fields are empty right now, as concrete paths.
    -------------------------------------------------------------------------
    §2.6's F8. `required` has been on every descriptor since the model existed
    (`cms/fields.ts`), and nothing read it: a schema's `z.string()` is required
    *and* accepts `""`, so an owner could clear their own page's heading and the
    server would commit the emptiness without a word. The panel is where that is
    asked, exactly as `imageNeedsAlt` is — the content edge validates against the
    same schema the build does, and weakening it to insist on non-empty strings
    would change what the site accepts rather than what the editor offers.

    Three kinds are deliberately not asked about. A boolean's `false` is an
    answer. A group and an array are containers, and an empty list is a real
    state — a gallery with nothing in it yet. And an image is the picker's
    question rather than this one: its value can be a staged upload the server
    resolves, so an emptiness here would be a lie half the time, and
    `Uploads.missingAlt` already holds Save for the half that matters.

    Array rows are expanded against `values` through `retarget`, the same way
    `render` draws them, so a row an owner added this minute is asked about in
    its own right rather than through the template it came from. */
export function emptyRequired(fields: Field[], values: unknown): string[] {
  const out: string[] = [];
  const walk = (field: Field): void => {
    if (field.kind === "group") {
      for (const child of field.fields) walk(child);
      return;
    }
    if (field.kind === "array") {
      const rows = valueAt(values, field.path);
      if (!Array.isArray(rows)) return;
      for (const [index] of rows.entries()) {
        walk(retarget(field.item, `${field.path}[]`, `${field.path}[${index}]`));
      }
      return;
    }
    if (field.kind === "boolean" || field.kind === "image") return;
    if (!field.required) return;
    const value = valueAt(values, field.path);
    /* `0` and `false` are values; only nothing is nothing. A string of spaces
       is nothing too — it satisfies a schema and reads as a blank heading. */
    if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
      out.push(field.path);
    }
  };
  for (const field of fields) walk(field);
  return out;
}

/** The owner's unsaved words, as text they can paste somewhere.
    -------------------------------------------------------------------------
    §2.6's F7. A conflict is the one failure whose only safe ending is a reload,
    and a reload drops everything typed since the page opened — so the note that
    offers it has to offer *keeping the words* first. This is what goes on the
    clipboard: each change under the field's own human label, because a path
    means nothing to the person reading it later, and the page's own address at
    the end for the same reason the review widget puts it there.

    Labels come from the model rather than from either surface, so the bar and
    the panel copy the same text for the same edit. A value that is not a string
    — a whole reordered list — is written as JSON: unlovely, and better than
    silently leaving an owner's work out of the thing that promised to keep it. */
export function draftText(fields: Field[], edits: Array<{ path: string; value: unknown }>, where: string): string {
  const parts: string[] = [];
  for (const edit of edits) {
    const label = findField(fields, edit.path)?.label ?? edit.path;
    const text = typeof edit.value === "string" ? edit.value : JSON.stringify(edit.value);
    parts.push(`${label}:\n${text}`);
  }
  parts.push(`— ${where}`);
  return parts.join("\n\n");
}

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
