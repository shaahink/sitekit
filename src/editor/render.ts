/* Turning field descriptors into controls.
   ---------------------------------------------------------------------------
   Nothing in here knows what any site's content is. It knows that a schema
   describes groups, lists and four kinds of scalar, and it draws those — which
   is the whole bet of PLAN §3.9: adding the editor to the next site costs
   wiring, not a hand-built admin screen.

   Repeaters render the rows that exist and let their fields be edited. Adding,
   removing and reordering rows is deliberately absent here — that is session
   7.6's, with the gallery work it belongs to. */

import type { Field, ScalarField } from "../cms/fields.js";
import type { Dirty } from "./dirty.js";
import { el, grow } from "./dom.js";
import type { EditorStrings } from "./strings.js";
import { coerce, fieldId, retarget, valueAt } from "./values.js";

export interface RenderContext {
  strings: EditorStrings;
  dirty: Dirty;
  /** Called whenever a control changes, so the save button can re-read the
      dirty count rather than track it a second time. */
  changed(): void;
}

export function render(field: Field, values: unknown, context: RenderContext): HTMLElement {
  if (field.kind === "group") {
    const group = el("fieldset", "sk-editor__group");
    group.append(el("legend", "sk-editor__legend", field.label));
    for (const child of field.fields) group.append(render(child, values, context));
    return group;
  }

  if (field.kind === "array") {
    const group = el("fieldset", "sk-editor__group sk-editor__group--list");
    group.append(el("legend", "sk-editor__legend", field.label));
    const rows = valueAt(values, field.path);
    if (!Array.isArray(rows) || rows.length === 0) {
      group.append(el("p", "sk-editor__note", context.strings.emptyList));
      return group;
    }
    rows.forEach((_, index) => {
      const row = retarget(field.item, `${field.path}[]`, `${field.path}[${index}]`);
      const numbered = `${row.label} ${index + 1}`;
      /* A row that is an object already draws a titled box, so it numbers its
         own legend rather than getting a heading on top of a heading. */
      if (row.kind === "group") {
        group.append(render({ ...row, label: numbered }, values, context));
        return;
      }
      const box = el("div", "sk-editor__row");
      box.append(el("p", "sk-editor__rowlabel", numbered));
      box.append(render(row, values, context));
      group.append(box);
    });
    return group;
  }

  return control(field, valueAt(values, field.path), context);
}

function control(field: ScalarField, value: unknown, context: RenderContext): HTMLElement {
  const { strings, dirty } = context;
  const wrap = el("div", "sk-editor__field");
  const id = fieldId(field.path);

  const caption = el("label", "sk-editor__label", field.label);
  caption.htmlFor = id;
  if (!field.required) caption.append(el("span", "sk-editor__optional", strings.optional));
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
    wrap.classList.toggle("is-changed", dirty.update(field.path, raw, coerce(field, raw)));
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
  area.value = scalar(value ?? field.default);
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
