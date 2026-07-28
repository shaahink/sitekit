/* The form model, derived from the content schema.
   ---------------------------------------------------------------------------
   This is the whole bet of PLAN §3.9: if the editor can be generated from the
   Zod schemas the sites already have, adding it to a site costs nothing but
   wiring. Zod 4 ships `z.toJSONSchema()`, so this walks that output and emits
   field descriptors the client renders. Pure — no DOM, no fetch — so it is
   unit-testable like everything else in the kit.

   `io: "input"` matters. In output mode Zod marks `.default()` fields as
   required, because after parsing they always exist. But the editor edits the
   *file*, and a file may legitimately omit a defaulted field — output mode
   would flag perfectly valid content as incomplete. Input mode describes what
   the YAML may contain, which is the question being asked here. */

import { z } from "zod";
import type { Field, FieldCommon } from "./fields.js";

const MAX_SAFE = 9007199254740991;

/* The descriptors themselves live in fields.ts — the browser half of the
   editor needs them too, and it compiles under a different lib. */
export type { Field, FieldCommon, SelectOption } from "./fields.js";

export interface FormModelOptions {
  /** Template paths to leave out — `images[].w` and friends. The layouts
      depend on pixel sizes, so they are not an owner's business to edit. */
  omit?: string[];
}

/** The top-level object's fields. Throws if the schema isn't an object, which
    every content collection is. */
export function formModel(schema: z.ZodType, options: FormModelOptions = {}): Field[] {
  const root = z.toJSONSchema(schema, { io: "input" }) as Node;
  const omit = new Set(options.omit ?? []);
  const resolved = deref(root, root);
  if (!resolved.properties) throw new Error("content schema must be an object");
  return groupFields(resolved, "", root, omit);
}

/* --- the walk --------------------------------------------------------- */

interface Node {
  type?: string | string[];
  properties?: Record<string, Node>;
  required?: string[];
  items?: Node;
  anyOf?: Node[];
  oneOf?: Node[];
  const?: unknown;
  enum?: unknown[];
  default?: unknown;
  title?: string;
  description?: string;
  maxLength?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  format?: string;
  $ref?: string;
  $defs?: Record<string, Node>;
}

function groupFields(node: Node, prefix: string, root: Node, omit: Set<string>): Field[] {
  const required = new Set(node.required ?? []);
  const fields: Field[] = [];
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (omit.has(path)) continue;
    const field = walk(deref(child, root), path, humanize(key), required.has(key), root, omit);
    if (field) fields.push(field);
  }
  return fields;
}

function walk(
  node: Node,
  path: string,
  fallbackLabel: string,
  required: boolean,
  root: Node,
  omit: Set<string>
): Field | null {
  /* A schema may name its own field: `z.string().meta({ title: "Persian
     name" })` reaches JSON Schema as `title`, and `title` is the standard
     keyword for exactly this. It matters more than it sounds, because the
     label is not only a form heading — the inline editor puts it in the bar
     as "Changing Persian name", which is the whole of what tells an owner
     what they are typing into.

     Without it the label is the key humanized, and short keys make that
     useless: `name.fa` reads as "Fa", `poem.html` as "Html". A site can fix
     that here rather than by renaming the keys in its content files. */
  const label = node.title ?? fallbackLabel;

  const common: FieldCommon = {
    path,
    label,
    required,
    ...(node.description ? { help: node.description } : {})
  };

  /* The other spelling of a closed set, and the one anybody writing a new
     schema reaches for first: `z.enum(["draft", "live"])`. It arrives as an
     `enum` array rather than as branches, so it used to fall through to a text
     box — a box that accepts a typo the panel cannot catch and the build then
     rejects, which is the worst of both. Found by reading a generated form
     model rather than by trusting it. */
  if (node.enum?.length) {
    return {
      ...common,
      kind: "select",
      options: node.enum.map((value) => ({
        value: value as string | number | boolean,
        label: String(value)
      })),
      ...(isScalarDefault(node.default) ? { default: node.default } : {})
    };
  }

  /* A closed set of literals is a select — `z.union([z.literal(2),
     z.literal(3)])` is how the fleet spells "two or three columns". */
  const branches = node.anyOf ?? node.oneOf;
  if (branches?.length) {
    const resolvedBranches = branches.map((b) => deref(b, root));
    if (resolvedBranches.every((b) => b.const !== undefined)) {
      return {
        ...common,
        kind: "select",
        options: resolvedBranches.map((b) => ({
          value: b.const as string | number | boolean,
          label: String(b.const)
        })),
        ...(isScalarDefault(node.default) ? { default: node.default } : {})
      };
    }
    /* Otherwise it's a nullable or a genuine union; edit the first real
       branch rather than refusing to render the field at all. */
    const first = resolvedBranches.find((b) => typeName(b) !== "null");
    if (first) return walk(first, path, label, required, root, omit);
    return null;
  }

  switch (typeName(node)) {
    case "object": {
      const fields = groupFields(node, path, root, omit);
      /* A group whose every child was omitted has nothing to show, and drawing
         it anyway gives the panel an empty box with a label still on it — which
         reads as a field that failed to load rather than as one deliberately
         withheld. shade's `images[].lg` was exactly this: two omitted pixel
         sizes and a box labelled "Lg". */
      if (fields.length === 0) return null;
      return { ...common, kind: "group", fields };
    }

    case "array": {
      if (!node.items) return null;
      const item = walk(deref(node.items, root), `${path}[]`, singular(label), true, root, omit);
      return item ? { ...common, kind: "array", item } : null;
    }

    case "boolean":
      return {
        ...common,
        kind: "boolean",
        ...(typeof node.default === "boolean" ? { default: node.default } : {})
      };

    case "integer":
    case "number": {
      const min = node.exclusiveMinimum ?? node.minimum;
      const max = node.exclusiveMaximum ?? node.maximum;
      return {
        ...common,
        kind: "number",
        integer: typeName(node) === "integer",
        ...(min !== undefined && Math.abs(min) !== MAX_SAFE ? { min } : {}),
        ...(max !== undefined && Math.abs(max) !== MAX_SAFE ? { max } : {}),
        ...(typeof node.default === "number" ? { default: node.default } : {})
      };
    }

    /* Everything else — including `z.any()`, which emits no type at all —
       is editable as text. Better a plain box than a missing field. */
    default:
      return {
        ...common,
        kind: "text",
        long: node.maxLength === undefined,
        ...(node.maxLength !== undefined ? { maxLength: node.maxLength } : {}),
        ...(node.minLength !== undefined ? { minLength: node.minLength } : {}),
        ...(node.format ? { format: node.format } : {}),
        ...(typeof node.default === "string" ? { default: node.default } : {})
      };
  }
}

/* Reused schemas inline by default in Zod 4, so `$ref` should never appear
   for the fleet's shapes. It is resolved anyway because a recursive schema or
   an explicit registry would produce one, and a silently mis-rendered field
   is far worse than eight lines of insurance. */
function deref(node: Node, root: Node): Node {
  let current = node;
  for (let hops = 0; current.$ref && hops < 10; hops++) {
    const name = current.$ref.replace(/^#\/\$defs\//, "");
    const target = root.$defs?.[name];
    if (!target) throw new Error(`unresolvable $ref: ${current.$ref}`);
    current = target;
  }
  return current;
}

function typeName(node: Node): string {
  if (Array.isArray(node.type)) return node.type.find((t) => t !== "null") ?? "null";
  return node.type ?? "";
}

function isScalarDefault(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** `ogDescription` → `Og description`. Not clever, and it doesn't need to be:
    the field's own name is what the owner recognises from their content. */
function humanize(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** A row inside `Slides` is a `Slide`. Crude, and only ever a label.

    The `-es` rules want a stem that already hisses — class, box, dish — and
    `sses` is what distinguishes those from a word that simply ends in `-se`.
    Without it "Promises" came out as "Promis", because `ses` matched. English
    keeps one genuine ambiguity here ("Buses" reads as "Buse") and that is left
    alone: it is a row heading, and inventing more rules for it would cost more
    than it saves. */
function singular(label: string): string {
  if (/(sses|xes|zes|ches|shes)$/i.test(label)) return label.slice(0, -2);
  if (/ies$/i.test(label)) return `${label.slice(0, -3)}y`;
  if (/[^s]s$/i.test(label)) return label.slice(0, -1);
  return label;
}
