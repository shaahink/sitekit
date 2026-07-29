/* The widget's words, and the two things about them that fail silently.
   ---------------------------------------------------------------------------
   A string table is not interesting to test until you notice how it goes
   wrong. Both ways it does are invisible: a locale table missing a key renders
   the literal `undefined` into a reviewer's button, and a language that does
   not match falls back to English on a Farsi page without anything erroring.
   Neither shows up in a build, in a type-check, or in a page that a developer
   who reads English happens to load.

   The third test is a provenance check. Elfine's French and Nima's Farsi were
   written for their own sites and lifted here character for character when the
   chrome moved into the kit at 0.16.0. `widget-strings.forked.json` was
   extracted from those two repos mechanically (see
   `scripts/extract-widget-strings.mjs`) *before* the files it read were
   deleted, so it is the only surviving record of what six live sites served.
   Comparing against it is what makes "lifted verbatim" a measurement. */

import { describe, expect, it } from "vitest";
import forked from "./fixtures/widget-strings.forked.json" with { type: "json" };
import {
  defaultStrings,
  fill,
  stringsFor,
  widgetLocales,
  widgetStrings,
  type WidgetStrings
} from "../src/widget/strings.js";

const keys = Object.keys(defaultStrings) as (keyof WidgetStrings)[];

describe("every locale table", () => {
  it("ships all three locales the fleet needs", () => {
    expect(Object.keys(widgetLocales).sort()).toEqual(["en", "fa", "fr"]);
  });

  for (const [locale, table] of Object.entries(widgetLocales)) {
    it(`${locale} has every key, with nothing blank`, () => {
      for (const key of keys) {
        expect(table[key], `${locale}.${key}`).toBeTypeOf("string");
        expect(table[key]!.trim(), `${locale}.${key}`).not.toBe("");
      }
      /* And nothing extra: a key here that the interface dropped is a string
         no surface reads, which is how a table starts looking translated
         while the widget says something else. */
      expect(Object.keys(table).sort()).toEqual([...keys].sort());
    });

    it(`${locale} keeps the {n} placeholder in countMany`, () => {
      expect(table.countMany).toContain("{n}");
      expect(fill(table.countMany, { n: 3 })).toContain("3");
      expect(fill(table.countMany, { n: 3 })).not.toContain("{n}");
    });
  }
});

describe("stringsFor", () => {
  it("matches a bare subtag", () => {
    expect(stringsFor("fa")).toBe(widgetLocales.fa);
    expect(stringsFor("fr")).toBe(widgetLocales.fr);
  });

  it("matches a region tag, which is what <html lang> usually carries", () => {
    expect(stringsFor("fa-IR")).toBe(widgetLocales.fa);
    expect(stringsFor("fr-CA")).toBe(widgetLocales.fr);
  });

  it("is case-insensitive and takes an underscore too", () => {
    expect(stringsFor("FA")).toBe(widgetLocales.fa);
    expect(stringsFor("fr_FR")).toBe(widgetLocales.fr);
  });

  /* Both forks tested `lang.indexOf("fa") === 0`, which also matched Faroese.
     Harmless on a site that only ever serves two languages and wrong in a kit
     that serves any site, so the tag is split rather than prefix-matched. */
  it("does not mistake a longer subtag for a shorter one", () => {
    expect(stringsFor("fao")).toBe(defaultStrings);
    expect(stringsFor("frr")).toBe(defaultStrings);
  });

  it("falls back to English rather than to blanks", () => {
    expect(stringsFor("de")).toBe(defaultStrings);
    expect(stringsFor("")).toBe(defaultStrings);
    expect(stringsFor(null)).toBe(defaultStrings);
    expect(stringsFor(undefined)).toBe(defaultStrings);
  });
});

describe("widgetStrings", () => {
  it("puts a site's overrides on top of the locale table", () => {
    const strings = widgetStrings("fr", { send: "Envoie !" });
    expect(strings.send).toBe("Envoie !");
    /* The point of the order: overriding one word keeps the other twenty-seven
       in French, rather than dropping the site back to English. */
    expect(strings.cancel).toBe(widgetLocales.fr!.cancel);
  });

  it("overrides an unlisted language against the English defaults", () => {
    const strings = widgetStrings("de", { send: "Senden" });
    expect(strings.send).toBe("Senden");
    expect(strings.cancel).toBe(defaultStrings.cancel);
  });

  it("does not mutate the table it copies", () => {
    widgetStrings("fa", { send: "x" });
    expect(widgetLocales.fa!.send).toBe(forked.fa.send);
  });
});

describe("the lifted translations", () => {
  /* The fixture predates the two keys below: they were hardcoded English in
     all six copies — a Farsi reviewer on nimagiti met "Review mode" and "More"
     in a screen reader — so they are new writing here and have nothing to be
     compared against. Everything else must match to the character. */
  const written = ["regionLabel", "more"];
  const lifted = keys.filter((key) => !written.includes(key));

  for (const [locale, table] of Object.entries(widgetLocales)) {
    it(`${locale} matches what the fleet was serving`, () => {
      const source = (forked as Record<string, Record<string, string>>)[locale]!;
      for (const key of lifted) {
        expect(table[key], `${locale}.${key}`).toBe(source[key]);
      }
      expect(Object.keys(source).sort()).toEqual([...lifted].sort());
    });
  }

  /* Two details worth pinning because a well-meaning edit would "fix" them:
     the Persian count is written with a Persian numeral, and all three tables
     name Shahin — which every site was already saying, and which a kit release
     is the wrong place to silently change. */
  it("keeps the Persian numeral in fa.countOne", () => {
    expect(widgetLocales.fa!.countOne).toContain("۱");
  });

  it("keeps the studio's name where all six sites had it", () => {
    for (const table of Object.values(widgetLocales)) {
      expect(table.sentBody.toLowerCase()).toMatch(/shahin|شاهین/);
    }
  });
});

describe("fill", () => {
  it("leaves an unknown placeholder as a template rather than a gap", () => {
    expect(fill("{a} and {b}", { a: "1" })).toBe("1 and {b}");
  });
});
