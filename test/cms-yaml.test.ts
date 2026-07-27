import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { applyEdits, normalize, parsePath, readValues } from "../src/cms/yaml.js";

/* Bez's real home.yaml, not a toy: mixed block scalars and long quoted
   strings, Persian text, arrays of objects. The whole normalisation decision
   was made against this file, so the tests are made against it too. */
const SOURCE = readFileSync(new URL("./fixtures/bez-home.yaml", import.meta.url), "utf8");

/** Added plus removed lines, by longest common subsequence — the `+`/`−` count
    git would print. A positional comparison will not do: collapsing a folded
    scalar from three lines to one shifts everything below it, which reads as a
    whole-file rewrite when nothing of the sort happened. */
function changedLines(before: string, after: string): number {
  const a = before.split("\n");
  const b = after.split("\n");
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const common = lcs[0]![0]!;
  return a.length - common + (b.length - common);
}

describe("normalize", () => {
  it("is a fixed point — the reflow happens once and never again", () => {
    const once = normalize(SOURCE);
    expect(normalize(once)).toBe(once);
  });

  it("changes no values on the way through", () => {
    expect(parse(normalize(SOURCE))).toEqual(parse(SOURCE));
  });

  it("keeps the comments that explain the content model", () => {
    const withComments = "# why this exists\nkey: value\n";
    expect(normalize(withComments)).toContain("# why this exists");
  });

  it("rejects YAML that doesn't parse rather than silently dropping it", () => {
    expect(() => normalize("key: [unclosed\n")).toThrow(/not valid YAML/);
  });
});

describe("applyEdits", () => {
  const NORMALIZED = normalize(SOURCE);

  it("replaces exactly one line for a one-field edit", () => {
    const after = applyEdits(NORMALIZED, [{ path: "hero.cue", value: "Begin" }]);
    /* One removed, one added — a single-line hunk. */
    expect(changedLines(NORMALIZED, after)).toBe(2);
    expect(parse(after).hero.cue).toBe("Begin");
  });

  it("keeps a folded block scalar folded", () => {
    const after = applyEdits(NORMALIZED, [
      { path: "hero.tagline", value: "A shorter line about repetition." }
    ]);
    expect(after).toContain("tagline: >-");
    expect(parse(after).hero.tagline).toBe("A shorter line about repetition.");
  });

  it("edits a field nested inside an array", () => {
    const after = applyEdits(NORMALIZED, [
      { path: "hero.slides[0].alt", value: "A new description of the first slide" }
    ]);
    expect(parse(after).hero.slides[0].alt).toBe("A new description of the first slide");
    /* The other four slides are untouched. */
    expect(parse(after).hero.slides[1]).toEqual(parse(NORMALIZED).hero.slides[1]);
  });

  it("writes Persian text back intact", () => {
    const after = applyEdits(NORMALIZED, [{ path: "hero.glyph", value: "حافظه" }]);
    expect(parse(after).hero.glyph).toBe("حافظه");
  });

  it("keeps the diff proportional across mixed field kinds at once", () => {
    const after = applyEdits(NORMALIZED, [
      { path: "meta.title", value: "Bruce Nemeth — Artist" },
      { path: "hero.tagline", value: "An artist listening for difference." },
      { path: "hero.slides[1].alt", value: "Red strokes on dark canvas" }
    ]);
    /* Three fields across a quoted scalar, a folded block and an array-nested
       field. The folded scalar was three source lines and becomes one, so two
       extra removals ride along: +3/−4, which is what session 7's ground truth
       measured against this same file. A diff a human reads in seconds. */
    expect(changedLines(NORMALIZED, after)).toBeLessThanOrEqual(8);
    const values = parse(after);
    expect(values.meta.title).toBe("Bruce Nemeth — Artist");
    expect(values.hero.tagline).toBe("An artist listening for difference.");
    expect(values.hero.slides[1].alt).toBe("Red strokes on dark canvas");
  });

  it("leaves the result normalized, so the next edit is minimal too", () => {
    const after = applyEdits(NORMALIZED, [{ path: "hero.cue", value: "Begin" }]);
    expect(normalize(after)).toBe(after);
  });

  it("writes numbers and booleans as themselves, not as strings", () => {
    const after = applyEdits(NORMALIZED, [{ path: "hero.slides[0].w", value: 1600 }]);
    expect(parse(after).hero.slides[0].w).toBe(1600);
    expect(after).not.toContain('w: "1600"');
  });

  it("returns the source untouched when there is nothing to change", () => {
    expect(applyEdits(NORMALIZED, [])).toBe(NORMALIZED);
  });

  it("survives a value that a folded scalar cannot hold", () => {
    /* Trailing whitespace and a newline cannot round-trip through `>-`. The
       writer must fall back rather than commit something the owner didn't
       type — that fallback is the reason applyEdits verifies its own output. */
    const awkward = "first line  \n\n  indented second";
    const after = applyEdits(NORMALIZED, [{ path: "hero.tagline", value: awkward }]);
    expect(parse(after).hero.tagline).toBe(awkward);
  });
});

describe("readValues", () => {
  it("parses the document the schema will validate", () => {
    const values = readValues(SOURCE) as { hero: { nameLatin: string } };
    expect(values.hero.nameLatin).toBe("Bruce");
  });
});

describe("parsePath", () => {
  it("splits keys and indices", () => {
    expect(parsePath("hero.slides[0].alt")).toEqual(["hero", "slides", 0, "alt"]);
    expect(parsePath("meta.title")).toEqual(["meta", "title"]);
    expect(parsePath("marquee[2]")).toEqual(["marquee", 2]);
  });

  it("rejects the form model's `[]` templates, which are not paths", () => {
    expect(() => parsePath("hero.slides[].alt")).toThrow();
  });

  it("rejects paths that could climb out of the document", () => {
    expect(() => parsePath("hero.slides[0]['../secret']")).toThrow();
  });
});
