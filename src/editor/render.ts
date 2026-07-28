/* Turning field descriptors into controls.
   ---------------------------------------------------------------------------
   Nothing in here knows what any site's content is. It knows that a schema
   describes groups, lists and four kinds of scalar, and it draws those — which
   is the whole bet of PLAN §3.9: adding the editor to the next site costs
   wiring, not a hand-built admin screen.

   Repeaters add, remove and reorder rows, and a picture field is a picker
   rather than a box holding a path. Both arrived in 7.6 and both are drawn
   from the same descriptors as everything else: nothing here was added for one
   site, and nothing here can be. */

import type { BooleanField, Field, ImageField, ScalarField } from "../cms/fields.js";
import type { Dirty } from "./dirty.js";
import { el, grow } from "./dom.js";
import { NotJpegError, shrinkImage, TooBigError } from "./image.js";
import { fill, type EditorStrings } from "./strings.js";
import { coerce, fieldId, retarget, valueAt, writeAt } from "./values.js";

export interface RenderContext {
  strings: EditorStrings;
  dirty: Dirty;
  /** Called whenever a control changes, so the save button can re-read the
      dirty count rather than track it a second time. */
  changed(): void;
  /** Photographs chosen but not yet saved. */
  uploads: Uploads;
}

/** The photographs waiting to go in the next commit.
    ---------------------------------------------------------------------------
    They travel beside the edits rather than inside them: an edit says
    `upload:u1` and the server substitutes the path once it knows where the
    file landed, so the browser never names a location in the repository. See
    cms/uploads.ts, where that decision is argued.

    It also holds which of them still owe a description. The schema defaults
    `alt` to `""`, so nothing downstream will stop an owner committing a
    photograph nobody using a screen reader can know anything about — the
    schema cannot insist, so the panel does. */
export class Uploads {
  private readonly items = new Map<
    string,
    { id: string; name: string; dataUrl: string; field: string; altPath?: string }
  >();
  private next = 1;

  /** Stage a photograph for `field`. One field holds one answer: choosing a
      second picture for the same slot replaces the first rather than
      committing both, and only one of them was ever going to be referenced. */
  add(field: string, name: string, dataUrl: string, altPath?: string): string {
    this.dropFor(field);
    const id = `u${this.next++}`;
    this.items.set(id, { id, name, dataUrl, field, ...(altPath ? { altPath } : {}) });
    return id;
  }

  /** Abandon whatever was staged for a field — the owner typed a path
      instead, which is the other answer to the same question. */
  dropFor(field: string): void {
    for (const [id, item] of this.items) if (item.field === field) this.items.delete(id);
  }

  list(): Array<{ id: string; name: string; dataUrl: string }> {
    return [...this.items.values()].map(({ id, name, dataUrl }) => ({ id, name, dataUrl }));
  }

  /** Which new photographs still have nothing written about them. */
  missingAlt(values: unknown): string[] {
    const out: string[] = [];
    for (const item of this.items.values()) {
      if (!item.altPath) continue;
      const alt = valueAt(values, item.altPath);
      if (typeof alt !== "string" || !alt.trim()) out.push(item.altPath);
    }
    return out;
  }

  get size(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
    this.next = 1;
  }
}

export function render(field: Field, values: unknown, context: RenderContext): HTMLElement {
  /* `values` is the panel's own copy of the document and every control writes
     back into it, so a repeater always has the current text of its rows to
     ship when they move. Nothing else reads it — the server applies edits to
     its own freshly-read file, which is what keeps a one-line edit a one-line
     diff. */
  if (field.kind === "group") {
    const group = el("fieldset", "sk-editor__group");
    group.append(el("legend", "sk-editor__legend", field.label));
    if (field.toggle) group.append(sectionSwitch(field.toggle, values, context, group));
    for (const child of field.fields) group.append(render(child, values, context));
    return group;
  }

  if (field.kind === "array") return list(field, values, context);

  return control(field, values, context);
}

/* Repeaters — the rows themselves, and the four things you can do to them.
   ---------------------------------------------------------------------------
   Buttons, not drag. Drag is poor on touch, worse with a screen reader, and
   this is a feature whose whole point is that an owner can use it from a phone
   on a bus. Four taps to move a photograph three places is not elegant; it is
   reachable, which beats elegant here.

   The array is mutated in the panel's own copy of the document and sent whole,
   for the reason Dirty explains: once rows move, `slides[1].alt` names a
   different photograph's caption, and a set of per-path edits cannot say that.
   So every control writes what it holds back into that copy as it is typed,
   and the copy is what a row operation ships. */
function list(
  field: Extract<Field, { kind: "array" }>,
  values: unknown,
  context: RenderContext
): HTMLElement {
  const { strings, dirty } = context;
  const group = el("fieldset", "sk-editor__group sk-editor__group--list");
  group.append(el("legend", "sk-editor__legend", field.label));

  let existing = valueAt(values, field.path);
  if (!Array.isArray(existing)) {
    existing = [];
    writeAt(values, field.path, existing);
  }
  const rows = existing as unknown[];
  dirty.trackList(field.path, rows);

  const body = el("div", "sk-editor__rows");
  group.append(body);

  const settled = (): void => {
    group.classList.toggle("is-changed", dirty.updateList(field.path, rows));
    context.changed();
  };

  const draw = (): void => {
    /* The controls below are about to be re-tracked against different values,
       so what was recorded against the old positions describes nothing now. */
    dirty.clearUnder(field.path);
    body.textContent = "";

    if (!rows.length) {
      body.append(el("p", "sk-editor__note", strings.emptyList));
      return;
    }

    rows.forEach((_, index) => {
      const row = retarget(field.item, `${field.path}[]`, `${field.path}[${index}]`);
      const numbered = `${row.label} ${index + 1}`;
      const box = el("div", "sk-editor__row");
      box.append(tools(index));

      /* A row that is an object already draws a titled box, so it numbers its
         own legend rather than getting a heading on top of a heading. */
      if (row.kind === "group") {
        box.append(render({ ...row, label: numbered }, values, context));
      } else {
        box.append(el("p", "sk-editor__rowlabel", numbered));
        box.append(render(row, values, context));
      }
      body.append(box);
    });
  };

  const move = (from: number, to: number): void => {
    if (to < 0 || to >= rows.length) return;
    const [row] = rows.splice(from, 1);
    rows.splice(to, 0, row);
    draw();
    settled();
    /* Focus follows the row, or four taps in a row means four hunts for the
       button that was under your thumb a moment ago. */
    focusTool(body, to, to > from ? "up" : "down");
  };

  function tools(index: number): HTMLElement {
    const bar = el("div", "sk-editor__rowtools");
    bar.append(
      iconButton("up", strings.rowUp, index === 0, () => move(index, index - 1)),
      iconButton("down", strings.rowDown, index === rows.length - 1, () => move(index, index + 1)),
      removeButton(index)
    );
    return bar;
  }

  /* Removing a row asks twice. Not a `confirm()` — it blocks, it looks like
     the browser rather than the editor, and on a phone it lands under a
     thumb already moving. A button that changes its own label is the same
     safeguard without any of that, and it forgets the question after a few
     seconds so a half-tap does not stay armed. */
  function removeButton(index: number): HTMLButtonElement {
    const button = el("button", "sk-editor__rowbutton sk-editor__rowbutton--remove", strings.rowRemove);
    button.type = "button";
    button.title = strings.rowRemove;
    let armed = 0;
    button.addEventListener("click", () => {
      if (armed) {
        clearTimeout(armed);
        rows.splice(index, 1);
        draw();
        settled();
        return;
      }
      button.textContent = strings.rowRemoveConfirm;
      button.classList.add("is-armed");
      armed = setTimeout(() => {
        button.textContent = strings.rowRemove;
        button.classList.remove("is-armed");
        armed = 0;
      }, 4000) as unknown as number;
    });
    return button;
  }

  const add = el("button", "sk-editor__rowadd", fill(strings.rowAdd, { label: field.item.label }));
  add.type = "button";
  add.addEventListener("click", () => {
    rows.push(blankRow(field.item));
    draw();
    settled();
    /* Straight into the new row: an owner who has just pressed Add is looking
       for somewhere to type, and it is at the bottom of a list that may be
       longer than the screen. */
    const last = body.querySelector<HTMLElement>(".sk-editor__row:last-of-type");
    last?.scrollIntoView({ block: "nearest" });
    last?.querySelector<HTMLElement>("textarea, input, select")?.focus();
  });
  group.append(add);

  draw();
  return group;
}

function iconButton(
  which: "up" | "down",
  label: string,
  disabled: boolean,
  run: () => void
): HTMLButtonElement {
  const button = el("button", `sk-editor__rowbutton sk-editor__rowbutton--${which}`, which === "up" ? "↑" : "↓");
  button.type = "button";
  button.disabled = disabled;
  /* The glyph is the affordance and the label is the name — a screen reader
     saying "up arrow" is not the same as saying "move up". */
  button.setAttribute("aria-label", label);
  button.title = label;
  button.dataset.tool = which;
  button.addEventListener("click", run);
  return button;
}

function focusTool(body: HTMLElement, index: number, which: "up" | "down"): void {
  const row = body.querySelectorAll<HTMLElement>(".sk-editor__row")[index];
  const button = row?.querySelector<HTMLButtonElement>(`[data-tool="${which}"]`);
  /* At the end of the list the button that was pressed is now disabled, so
     focus would be dropped on the body. The other one is where the owner is
     going next anyway. */
  if (button && !button.disabled) button.focus();
  else row?.querySelector<HTMLButtonElement>("[data-tool]:not(:disabled)")?.focus();
}

/** A new row, built from what the schema says each field starts as.

    A required field with no default arrives as `null` rather than as an
    invented zero or empty string. The save then fails naming that field, which
    is the honest outcome: an owner has added a row and not filled it in, and
    the alternative is committing a plausible-looking blank into their site. */
function blankRow(field: Field): unknown {
  if (field.kind === "group") {
    const row: Record<string, unknown> = {};
    const key = (path: string): string => path.slice(field.path.length + 1);
    if (field.toggle) row[key(field.toggle.path)] = field.toggle.default ?? true;
    for (const child of field.fields) row[key(child.path)] = blankRow(child);
    return row;
  }
  if (field.kind === "array") return [];
  if (field.kind === "boolean") return field.default ?? false;
  if (field.kind === "select") return field.default ?? field.options[0]?.value ?? null;
  if (field.kind === "number") return field.default ?? null;
  /* A new row's photograph is empty until one is chosen; the schema will
     refuse the save until it is, which is the honest outcome. */
  if (field.kind === "image") return "";
  return field.default ?? "";
}

/* A section's on/off switch, at the head of its box.
   ---------------------------------------------------------------------------
   It is an ordinary boolean control underneath — same Dirty, same edit, same
   save — and everything different about it is wording and position. Both of
   those are the point.

   Position, because a checkbox labelled "Visible" sitting between two
   paragraphs is something an owner clicks while looking for a sentence. And
   wording, because "visible" is the schema's word for it: what the owner is
   being asked is whether this part of their site is on the internet, and the
   two things they need to know before answering are that turning it off takes
   it off the public page, and that nothing is deleted by doing so.

   The note also says the thing an owner cannot discover for themselves: a
   section that is off is not rendered at all, so the page it used to be on is
   not where you go to turn it back on. This panel is. */
function sectionSwitch(
  field: BooleanField,
  values: unknown,
  context: RenderContext,
  group: HTMLElement
): HTMLElement {
  const wrap = control(field, values, context, {
    label: context.strings.sectionShow
  });
  wrap.classList.add("sk-editor__section");

  const note = el("p", "sk-editor__sectionnote", context.strings.sectionHidden);
  wrap.append(note);

  const input = wrap.querySelector("input") as HTMLInputElement;
  const reflect = (): void => {
    /* The whole box dims, not just the switch: the fields below it are still
       editable and still saved, and an owner needs to see at a glance that
       what they are typing is not on the site yet. */
    group.classList.toggle("is-off", !input.checked);
    note.hidden = input.checked;
  };
  input.addEventListener("input", reflect);
  reflect();

  return wrap;
}

/* A photograph, from a phone, over a connection that is not a desk.
   ---------------------------------------------------------------------------
   Three things this has to get right, and each of them was a line in 7.6's
   "Watch for":

   The wait is real — 3–6 MB shrinking on a phone takes seconds, and an
   interface that says nothing gets tapped twice. So it says what it is doing
   while it does it, and the control is disabled meanwhile.

   `alt` is not optional in practice, only in the schema. A new photograph
   whose description is empty holds Save until it isn't, because nothing
   downstream will ever ask again.

   `w` and `h` are written, never typed. They are usually omitted from the
   form — an owner has no business entering pixel counts — so the picker knows
   their paths from the schema and fills them in beside the file. */
function imageControl(field: ImageField, values: unknown, context: RenderContext): HTMLElement {
  const { strings, dirty, uploads } = context;
  const wrap = el("div", "sk-editor__field sk-editor__image");
  const id = fieldId(field.path);
  const current = typeof valueAt(values, field.path) === "string" ? (valueAt(values, field.path) as string) : "";

  wrap.append(el("p", "sk-editor__label", field.label));
  if (field.help) wrap.append(el("p", "sk-editor__help", field.help));

  const preview = el("img", "sk-editor__preview");
  preview.alt = "";
  preview.loading = "lazy";
  if (current) preview.src = current;
  else wrap.classList.add("is-empty");
  wrap.append(preview);

  /* A file input the browser styles is a file input nobody can make look like
     the rest of the panel, so the real one is hidden behind its own label —
     which is a genuine control for a keyboard and a screen reader, not a div
     pretending to be one. It goes first in the DOM so the stylesheet can put
     the focus ring on the label the eye is actually looking at.

     `capture` is deliberately not set: an owner adding a photograph has
     usually already taken it. */
  const file = el("input", "sk-editor__file");
  file.type = "file";
  file.accept = "image/*";
  file.id = id;

  const choose = el("label", "sk-editor__choose", current ? strings.imageReplace : strings.imageChoose);
  choose.htmlFor = id;
  const status = el("p", "sk-editor__imagestatus", "");
  wrap.append(file, choose, status);

  /* The panel could always re-point an image at another file that already
     exists, and that is a content decision an owner is entitled to make —
     elfine's schema says so in as many words. Turning `src` into a picker and
     nothing else would have quietly taken it away, so the box is still here,
     folded away because choosing a photograph is what an owner came to do. */
  const manual = el("details", "sk-editor__manual");
  manual.append(el("summary", "sk-editor__manualsummary", strings.imagePointAt));
  const pathBox = el("input", "sk-editor__input sk-editor__path");
  pathBox.type = "text";
  pathBox.value = current;
  /* A file path is a path in every language. */
  pathBox.setAttribute("dir", "ltr");
  pathBox.dataset.path = field.path;
  pathBox.setAttribute("aria-label", strings.imagePointAt);
  manual.append(pathBox);
  wrap.append(manual);

  /* Three paths are tracked, and only one of them has a control: `w` and `h`
     are derived and usually omitted from the form, which is exactly why the
     picker has to know them. */
  dirty.track(field.path, current);
  for (const path of [field.widthPath, field.heightPath]) {
    if (path) dirty.track(path, String(valueAt(values, path) ?? ""));
  }

  const mark = (): void => {
    wrap.classList.toggle("is-changed", dirty.has(field.path));
    context.changed();
  };

  const set = (path: string, value: unknown): void => {
    dirty.update(path, String(value), value);
    writeAt(values, path, value);
  };

  pathBox.addEventListener("input", () => {
    /* Typing a path abandons a photograph chosen for *this* slot but not
       saved — they are two answers to the same question and the last one asked
       wins. Photographs staged for other fields are none of its business. */
    uploads.dropFor(field.path);
    set(field.path, pathBox.value);
    preview.src = pathBox.value;
    wrap.classList.toggle("is-empty", !pathBox.value);
    status.textContent = "";
    status.classList.remove("is-bad");
    mark();
  });

  file.addEventListener("change", () => {
    const picked = file.files?.[0];
    if (!picked) return;
    file.disabled = true;
    choose.classList.add("is-busy");
    status.classList.remove("is-bad");
    /* A 3–6 MB photograph takes seconds to scale on a phone, and an interface
       that says nothing during those seconds gets tapped a second time. */
    status.textContent = strings.imageWorking;

    void shrinkImage(picked)
      .then((shrunk) => {
        const token = `upload:${uploads.add(field.path, picked.name, shrunk.dataUrl, field.altPath)}`;

        preview.src = shrunk.dataUrl;
        wrap.classList.remove("is-empty");
        choose.textContent = strings.imageReplace;
        status.textContent = fill(strings.imageReady, {
          width: shrunk.width,
          height: shrunk.height,
          size: Math.round(shrunk.bytes / 1024)
        });

        /* The file and the two numbers that came with it are one save: a `src`
           pointing at a photograph whose recorded size belongs to the previous
           one is a layout that jumps on every load. */
        pathBox.value = token;
        set(field.path, token);
        if (field.widthPath) set(field.widthPath, shrunk.width);
        if (field.heightPath) set(field.heightPath, shrunk.height);
        mark();
      })
      .catch((error: unknown) => {
        status.textContent =
          error instanceof TooBigError
            ? strings.imageTooBig
            : error instanceof NotJpegError
              ? strings.imageWrongType
              : strings.imageUnreadable;
        status.classList.add("is-bad");
      })
      .finally(() => {
        file.disabled = false;
        /* Cleared so that picking the same file again still fires `change` —
           a retry after a failure is the common case, and the same filename
           is the same filename. */
        file.value = "";
        choose.classList.remove("is-busy");
      });
  });

  return wrap;
}

function control(
  field: ScalarField,
  values: unknown,
  context: RenderContext,
  overrides: { label?: string } = {}
): HTMLElement {
  if (field.kind === "image") return imageControl(field, values, context);

  const { strings, dirty } = context;
  const value = valueAt(values, field.path);
  const wrap = el("div", "sk-editor__field");
  const id = fieldId(field.path);

  const caption = el("label", "sk-editor__label", overrides.label ?? field.label);
  caption.htmlFor = id;
  /* A switch is never "optional" — it always holds one of two answers, and the
     word beside it would read as though the section itself were. */
  if (!field.required && !overrides.label) caption.append(el("span", "sk-editor__optional", strings.optional));
  wrap.append(caption);
  if (field.help) wrap.append(el("p", "sk-editor__help", field.help));

  const input = build(field, value, wrap);
  input.id = id;
  input.dataset.path = field.path;
  wrap.append(input);

  if (field.kind !== "boolean" && field.kind !== "select") {
    /* The panel's chrome is LTR, but half the fleet's content is Persian.
       `dir="auto"` lets each field decide from its own first strong character,
       so Farsi reads right-to-left inside an English panel — and an RTL panel
       shows a Latin field left-to-right for the same reason. */
    input.setAttribute("dir", "auto");
  }

  if (field.kind === "text" && field.maxLength !== undefined) {
    const max = field.maxLength;
    const counter = el("p", "sk-editor__count", "");
    wrap.append(counter);
    const tick = (): void => {
      const length = (input as HTMLTextAreaElement).value.length;
      counter.textContent = `${length} / ${max}`;
      counter.classList.toggle("is-full", length >= max);
    };
    input.addEventListener("input", tick);
    tick();
  }

  const read = (): string | boolean =>
    field.kind === "boolean" ? (input as HTMLInputElement).checked : (input as HTMLInputElement).value;

  dirty.track(field.path, read());
  input.addEventListener("input", () => {
    const raw = read();
    const value = coerce(field, raw);
    wrap.classList.toggle("is-changed", dirty.update(field.path, raw, value));
    /* Into the panel's copy of the document as well, so a repeater above this
       field ships what is actually in the box when its rows move. */
    writeAt(values, field.path, value);
    context.changed();
  });
  /* A select and a checkbox fire `change`, not `input`, in enough browsers to
     matter; re-emit so there is one code path above this line. */
  if (field.kind === "select" || field.kind === "boolean") {
    input.addEventListener("change", () => input.dispatchEvent(new Event("input", { bubbles: true })));
  }

  return wrap;
}

function build(
  field: ScalarField,
  value: unknown,
  wrap: HTMLElement
): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  if (field.kind === "select") {
    const select = el("select", "sk-editor__input sk-editor__select");
    for (const option of field.options) {
      const node = el("option", "", option.label);
      node.value = String(option.value);
      select.append(node);
    }
    select.value = String(value ?? field.default ?? "");
    return select;
  }

  if (field.kind === "boolean") {
    const check = el("input", "sk-editor__check");
    check.type = "checkbox";
    check.checked = Boolean(value ?? field.default ?? false);
    wrap.classList.add("sk-editor__field--inline");
    return check;
  }

  if (field.kind === "number") {
    const number = el("input", "sk-editor__input");
    number.type = "number";
    number.inputMode = field.integer ? "numeric" : "decimal";
    if (field.integer) number.step = "1";
    number.value = scalar(value ?? field.default);
    return number;
  }

  /* One control for every string. The schema genuinely cannot tell a one-word
     eyebrow from a paragraph when neither carries a maxLength — the model's
     `long` hint is a guess and says so — so rather than act on a guess, this
     is a textarea sized to whatever the field actually holds. Which is also
     the kinder thing on a phone. */
  const area = el("textarea", "sk-editor__input sk-editor__input--text");
  area.rows = 1;
  area.value = scalar(value ?? (field.kind === "text" ? field.default : undefined));
  if (field.kind === "text" && field.maxLength !== undefined) area.maxLength = field.maxLength;
  area.addEventListener("input", () => grow(area));
  requestAnimationFrame(() => grow(area));
  return area;
}

/** A control's value is a string. Anything the schema didn't expect — a nested
    object where a string was described — would stringify to `[object Object]`
    and then be saved over the real thing, so it shows as empty instead. */
function scalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return "";
  return String(value);
}
