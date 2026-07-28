/* The field descriptors — the contract between the two halves of the editor.
   ---------------------------------------------------------------------------
   `formModel()` in form.ts generates these on the server from a content
   schema; `mountEditor()` in src/editor renders them in the browser. They are
   the only thing the two sides agree on, so they live in a file of their own
   rather than in either half: the server build and the browser build compile
   under different libs (WebWorker vs DOM) and must not drag each other's code
   along.

   Types only. Nothing here has a runtime. */

export interface SelectOption {
  value: string | number | boolean;
  label: string;
}

export interface FieldCommon {
  /** Dotted path into the document. Array item templates carry `[]`, as in
      `hero.slides[].alt`; the client substitutes an index per row. */
  path: string;
  label: string;
  required: boolean;
  /** From `.describe()`, when a schema carries one. */
  help?: string;
}

export type Field =
  | (FieldCommon & {
      kind: "text";
      /** No maxLength in the schema, so probably prose. Only picks the
          control's starting height — see the note on rendering below. */
      long: boolean;
      maxLength?: number;
      minLength?: number;
      format?: string;
      default?: string;
    })
  | (FieldCommon & {
      kind: "number";
      integer: boolean;
      min?: number;
      max?: number;
      default?: number;
    })
  | (FieldCommon & { kind: "boolean"; default?: boolean })
  | (FieldCommon & { kind: "select"; options: SelectOption[]; default?: string | number | boolean })
  | (FieldCommon & { kind: "group"; fields: Field[] })
  | (FieldCommon & { kind: "array"; item: Field });

/** A field that becomes one control. Groups and arrays become structure. */
export type ScalarField = Extract<Field, { kind: "text" | "number" | "boolean" | "select" }>;

