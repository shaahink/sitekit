import { describe, it, expect } from "vitest";
import { z } from "zod";
import { formModel, type Field } from "../src/cms/form.js";

/* Bez's real shapes, not toys — the same constructs session 7 probed before
   committing to generating the editor from the schemas. If the fleet's content
   model can't be walked, the whole approach is wrong. */
const picture = z.object({
  src: z.string(),
  alt: z.string().default(""),
  w: z.number().int().positive(),
  h: z.number().int().positive()
});

const schema = z.object({
  meta: z.object({
    title: z.string().max(280),
    description: z.string(),
    ogType: z.string().default("website"),
    twitterDescription: z.string().optional()
  }),
  columns: z.union([z.literal(2), z.literal(3)]).default(2),
  tall: z.boolean().default(false),
  hero: z.object({ slides: z.array(picture) }),
  pieces: z.array(picture.extend({ caption: z.string().default("") })),
  tags: z.array(z.string()),
  note: z.string().describe("Shown under the heading")
});

const fields = formModel(schema);
const byPath = new Map<string, Field>();
(function index(list: Field[]): void {
  for (const field of list) {
    byPath.set(field.path, field);
    if (field.kind === "group") index(field.fields);
    if (field.kind === "array") index([field.item]);
  }
})(fields);

describe("formModel", () => {
  it("groups nested objects rather than flattening them", () => {
    const meta = byPath.get("meta");
    expect(meta?.kind).toBe("group");
    expect(byPath.get("meta.title")?.kind).toBe("text");
  });

  it("carries maxLength through, so the counter is free", () => {
    const title = byPath.get("meta.title");
    expect(title).toMatchObject({ kind: "text", maxLength: 280, long: false });
  });

  it("marks a string with no length bound as prose", () => {
    expect(byPath.get("meta.description")).toMatchObject({ kind: "text", long: true });
  });

  it("treats a defaulted field as optional, because the file may omit it", () => {
    expect(byPath.get("meta.ogType")).toMatchObject({ required: false, default: "website" });
  });

  it("treats an optional field as optional", () => {
    expect(byPath.get("meta.twitterDescription")?.required).toBe(false);
  });

  it("keeps a plain field required", () => {
    expect(byPath.get("meta.title")?.required).toBe(true);
  });

  it("renders a union of literals as a select", () => {
    const columns = byPath.get("columns");
    expect(columns?.kind).toBe("select");
    expect(columns?.kind === "select" && columns.options.map((o) => o.value)).toEqual([2, 3]);
    expect(columns?.kind === "select" && columns.default).toBe(2);
  });

  it("renders a boolean as a boolean", () => {
    expect(byPath.get("tall")).toMatchObject({ kind: "boolean", default: false });
  });

  it("renders an array of objects as a repeater over a group", () => {
    const slides = byPath.get("hero.slides");
    expect(slides?.kind).toBe("array");
    expect(slides?.kind === "array" && slides.item.kind).toBe("group");
    /* The template path is what the client instantiates per row. */
    expect(byPath.get("hero.slides[].alt")?.kind).toBe("text");
  });

  it("renders an array of strings as a repeater over a text field", () => {
    const tags = byPath.get("tags");
    expect(tags?.kind === "array" && tags.item.kind).toBe("text");
  });

  it("walks a schema built with .extend()", () => {
    expect(byPath.get("pieces[].caption")?.kind).toBe("text");
    expect(byPath.get("pieces[].src")?.kind).toBe("text");
  });

  it("keeps int/positive bounds but drops the MAX_SAFE_INTEGER artifact", () => {
    const w = byPath.get("hero.slides[].w");
    expect(w).toMatchObject({ kind: "number", integer: true, min: 0 });
    /* Zod emits maximum: 9007199254740991 for .int(); rendering that in a form
       would be absurd. */
    expect(w?.kind === "number" && w.max).toBeUndefined();
  });

  it("uses .describe() as help text", () => {
    expect(byPath.get("note")?.help).toBe("Shown under the heading");
  });

  it("labels fields from their own names", () => {
    expect(byPath.get("meta.twitterDescription")?.label).toBe("Twitter description");
    expect(byPath.get("hero.slides")?.label).toBe("Slides");
    /* A row inside Slides is a Slide. */
    expect(byPath.get("hero.slides[]")?.label).toBe("Slide");
  });

  it("omits the fields a site says an owner shouldn't touch", () => {
    const trimmed = formModel(schema, { omit: ["hero.slides[].w", "hero.slides[].h"] });
    const paths: string[] = [];
    (function collect(list: Field[]): void {
      for (const field of list) {
        paths.push(field.path);
        if (field.kind === "group") collect(field.fields);
        if (field.kind === "array") collect([field.item]);
      }
    })(trimmed);
    expect(paths).toContain("hero.slides[].alt");
    expect(paths).not.toContain("hero.slides[].w");
    expect(paths).not.toContain("hero.slides[].h");
  });

  it("refuses a schema that isn't an object", () => {
    expect(() => formModel(z.string())).toThrow(/must be an object/);
  });
});
