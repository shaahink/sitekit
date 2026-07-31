/* The editor's words, and the way a translation actually fails.
   ---------------------------------------------------------------------------
   A missing key cannot happen here: `fr` and `fa` are both typed
   `EditorStrings`, so the compiler catches an absent one before any test runs.
   What a type cannot see is a key that is *present and still in English* — a
   line copied across while the table was being written and never replaced. It
   compiles, it renders, and it reads perfectly to whoever is reviewing the
   diff. On a Farsi page it is the one sentence the owner cannot read.

   So the test below is a comparison against English rather than a check for
   blanks, with an allowlist of the genuinely identical. The allowlist is short
   on purpose: every entry has to be a string that would be *wrong* to
   translate, not one that is merely hard to.

   The rest is `stringsFor` and `resolveEditorLang`, whose failures are equally
   quiet — a tag that does not match falls back to English on a Farsi site and
   nothing errors anywhere. Session 17 measured exactly that on all six sites
   before there was anything to fall back from. */

import { describe, expect, it } from "vitest";
import {
  defaultStrings,
  digitsFor,
  dirFor,
  editorLocales,
  editorStrings,
  fill,
  resolveEditorLang,
  stringsFor,
  type EditorStrings
} from "../src/editor/strings.js";
import { plural } from "../src/editor/values.js";

const keys = Object.keys(defaultStrings) as (keyof EditorStrings)[];
const translated = Object.entries(editorLocales).filter(([locale]) => locale !== "en");

/* Strings that are the same in every language because they are not language.
   "?" is a glyph; `homePageLine` is a path, an em dash and a number. Anything
   added here needs a reason of that kind. */
const NOT_LANGUAGE: (keyof EditorStrings)[] = [
  "inlineHelp",
  /* The overflow glyph, for the same reason as "?" — and its *name*,
     `inlineMoreTitle`, is what the three tables translate. */
  "inlineMore",
  /* The hint's dismiss glyph, and the same rule again: `hintDismissTitle` is
     the string with words in it and it is translated in all three tables. */
  "hintDismiss",
  "homeHelp",
  "homePageLine"
];

/* Every `{placeholder}` the English table uses, by key: a translation that
   drops one leaves an owner reading a sentence with a hole in it, and one that
   invents a new one leaves literal braces on the page — which is what half of
   0.14.0 shipped. */
const placeholders = new Map<string, string[]>(
  keys.map((key) => [key, [...defaultStrings[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)])
);

describe("every locale table", () => {
  it("ships the three locales the fleet's owners read", () => {
    expect(Object.keys(editorLocales).sort()).toEqual(["en", "fa", "fr"]);
  });

  for (const [locale, table] of Object.entries(editorLocales)) {
    it(`${locale} has every key, with nothing blank`, () => {
      for (const key of keys) {
        expect(table[key], `${locale}.${key}`).toBeTypeOf("string");
        expect(table[key].trim(), `${locale}.${key}`).not.toBe("");
      }
      /* And nothing extra: a key here the interface dropped is a string no
         surface reads, which is how a table starts looking translated while
         the editor says something else. */
      expect(Object.keys(table).sort()).toEqual([...keys].sort());
    });

    it(`${locale} keeps every placeholder the English string carries`, () => {
      for (const key of keys) {
        const wanted = placeholders.get(key)!;
        const got = [...table[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
        expect([...got].sort(), `${locale}.${key}`).toEqual([...wanted].sort());
      }
    });
  }

  for (const [locale, table] of translated) {
    it(`${locale} has no key left in English`, () => {
      const untranslated = keys.filter(
        (key) => !NOT_LANGUAGE.includes(key) && table[key] === defaultStrings[key]
      );
      expect(untranslated, `${locale} keys still reading as English`).toEqual([]);
    });
  }
});

describe("the two tables the audit exists because of", () => {
  /* Persian does not pluralise a noun after a numeral. Both keys have to be
     the singular, and a well-meaning edit that "fixes" `changes` to a plural
     is what this pins. */
  it("counts changes the way Persian counts", () => {
    expect(editorLocales.fa!.changes).toBe(editorLocales.fa!.change);
  });

  it("keeps the studio's name where the request goes to a person", () => {
    for (const table of Object.values(editorLocales)) {
      expect(table.homeRequestNote.toLowerCase()).toMatch(/shahin|شاهین/);
    }
  });

  /* The sentence session 17 measured on nimagiti's Farsi page and elfine's
     French one. If either of these ever reads English again, the finding has
     come back. */
  it("says the first thing an owner is told in their own language", () => {
    expect(editorLocales.fa!.inlineIdle).not.toBe(defaultStrings.inlineIdle);
    expect(editorLocales.fr!.inlineIdle).not.toBe(defaultStrings.inlineIdle);
  });
});

describe("stringsFor", () => {
  it("matches a bare subtag", () => {
    expect(stringsFor("fa")).toBe(editorLocales.fa);
    expect(stringsFor("fr")).toBe(editorLocales.fr);
  });

  it("matches a region tag, which is what <html lang> usually carries", () => {
    expect(stringsFor("fa-IR")).toBe(editorLocales.fa);
    expect(stringsFor("fr-CA")).toBe(editorLocales.fr);
  });

  it("is case-insensitive and takes an underscore too", () => {
    expect(stringsFor("FA")).toBe(editorLocales.fa);
    expect(stringsFor("fr_FR")).toBe(editorLocales.fr);
  });

  /* Both site forks of the widget tested `indexOf("fa") === 0`, which also
     matched Faroese. The tag is split rather than prefix-matched here for the
     same reason it is there. */
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

describe("editorStrings", () => {
  it("puts a site's overrides on top of the locale table", () => {
    const strings = editorStrings("fr", { save: "Publier" });
    expect(strings.save).toBe("Publier");
    /* The point of the order: overriding one word keeps the other hundred and
       twelve in French rather than dropping back to English. */
    expect(strings.cancel).toBe(editorLocales.fr!.cancel);
  });

  it("overrides an unlisted language against the English defaults", () => {
    const strings = editorStrings("de", { save: "Speichern" });
    expect(strings.save).toBe("Speichern");
    expect(strings.cancel).toBe(defaultStrings.cancel);
  });

  it("does not mutate the table it copies", () => {
    const before = editorLocales.fa!.save;
    editorStrings("fa", { save: "x" });
    expect(editorLocales.fa!.save).toBe(before);
  });
});

describe("dirFor", () => {
  it("turns the bar and the panel around for a right-to-left language", () => {
    expect(dirFor("fa")).toBe("rtl");
    expect(dirFor("fa-IR")).toBe("rtl");
  });

  it("leaves everything else alone", () => {
    expect(dirFor("en")).toBe("ltr");
    expect(dirFor("fr")).toBe("ltr");
    expect(dirFor(null)).toBe("ltr");
  });

  /* Wider than the tables on purpose: a site may override the strings into a
     language the kit does not ship, and direction is a property of the
     language rather than of whether we have words for it. */
  it("knows a right-to-left language the kit has no table for", () => {
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("he-IL")).toBe("rtl");
    expect(stringsFor("ar")).toBe(defaultStrings);
  });
});

/* Step 1 of 0.17.0 shipped the Farsi table and left the numbers Latin: an owner
   read "2 تغییر", which is the half-translation the whole exercise was against.
   Step 2 paid it, and these are the assertions that keep it paid. */
describe("digitsFor", () => {
  it("writes a Persian count in Persian digits", () => {
    expect(digitsFor("fa")(2)).toBe("۲");
    expect(digitsFor("fa-IR")(12)).toBe("۱۲");
  });

  it("leaves the Latin-digit languages alone", () => {
    expect(digitsFor("en")(2)).toBe("2");
    expect(digitsFor("fr")(2)).toBe("2");
  });

  /* Wider than the tables, like `dirFor`: a site may override the strings into
     a language the kit does not ship and its numbers should follow. */
  it("knows a digit set the kit has no table for", () => {
    expect(digitsFor("ar-EG")(2)).toBe("٢");
    expect(digitsFor("ps")(2)).toBe("۲");
  });

  /* Measured, and it is why this function does not truncate the tag the way
     `stringsFor` must. CLDR's default numbering system belongs to the locale:
     bare `ar` is Latin and `ar-EG` is Arabic-Indic, bare `ur` is Latin and
     `ur-IN` is Persian. Cutting `ar-EG` down to `ar` would print the wrong
     digits for Egypt while looking like a tidy-up. */
  it("keeps the region, because the region is what decides the digits", () => {
    expect(digitsFor("ar")(2)).toBe("2");
    expect(digitsFor("ar-EG")(2)).toBe("٢");
    expect(digitsFor("ur")(2)).toBe("2");
    expect(digitsFor("ur-IN")(2)).toBe("۲");
  });

  it("takes the tag as a site's markup actually spells it", () => {
    expect(digitsFor("FA-IR")(2)).toBe("۲");
    expect(digitsFor("fa_IR")(2)).toBe("۲");
    expect(digitsFor(" fa ")(2)).toBe("۲");
  });

  it("costs Latin digits rather than the editor when the tag is nonsense", () => {
    expect(digitsFor("!!")(2)).toBe("2");
    expect(digitsFor("")(2)).toBe("2");
    expect(digitsFor(null)(2)).toBe("2");
  });

  it("hands back the same formatter twice — the bar asks on every keystroke", () => {
    expect(digitsFor("fa")).toBe(digitsFor("fa"));
  });
});

describe("plural, with the digits the language uses", () => {
  it("puts a Persian numeral in front of the un-pluralised noun", () => {
    const fa = editorLocales.fa!;
    expect(plural(2, fa.change, fa.changes, digitsFor("fa"))).toBe(`۲ ${fa.change}`);
    expect(plural(1, fa.change, fa.changes, digitsFor("fa"))).toBe(`۱ ${fa.change}`);
  });

  it("still pluralises where the language does", () => {
    expect(plural(1, "change", "changes", digitsFor("en"))).toBe("1 change");
    expect(plural(2, "change", "changes", digitsFor("en"))).toBe("2 changes");
    expect(plural(2, "modification", "modifications", digitsFor("fr"))).toBe("2 modifications");
  });

  /* The default matters: `plural` is called from the panel, the bar and the
     drafts note, and a caller that forgets the formatter must still produce a
     sentence. */
  it("writes Latin digits when nobody says otherwise", () => {
    expect(plural(2, "change", "changes")).toBe("2 changes");
  });
});

describe("resolveEditorLang", () => {
  it("prefers the link the owner followed", () => {
    expect(
      resolveEditorLang({ asked: "fa", remembered: "fr", preferred: ["en"] })
    ).toBe("fa");
  });

  it("then what it remembered, so the question is asked once", () => {
    expect(resolveEditorLang({ remembered: "fr", preferred: ["en-GB"] })).toBe("fr");
  });

  it("then the browser's own preference", () => {
    expect(resolveEditorLang({ preferred: ["fr-CA", "en"] })).toBe("fr");
  });

  /* The reason this is a loop rather than a chain of `??`: a browser whose
     first preference is German and whose second is French should get French,
     not English-because-German-was-not-found. */
  it("skips a language the kit does not ship rather than giving up on it", () => {
    expect(resolveEditorLang({ preferred: ["de", "fr", "en"] })).toBe("fr");
    expect(resolveEditorLang({ asked: "de", remembered: "fa" })).toBe("fa");
  });

  it("ends at English rather than at nothing", () => {
    expect(resolveEditorLang({})).toBe("en");
    expect(resolveEditorLang({ asked: "", remembered: null, preferred: [] })).toBe("en");
    expect(resolveEditorLang({ preferred: ["de", "es"] })).toBe("en");
  });

  it("returns a tag, because the caller writes it to <html lang> as well", () => {
    expect(resolveEditorLang({ asked: "FA-IR" })).toBe("fa");
  });
});

describe("fill, in each language", () => {
  it("fills a count into a sentence that has a place for it", () => {
    for (const [locale, table] of Object.entries(editorLocales)) {
      const line = fill(table.inlinePending, { count: 2 });
      expect(line, `${locale}.inlinePending`).toContain("2");
      expect(line, `${locale}.inlinePending`).not.toContain("{count}");
    }
  });

  it("leaves an unknown placeholder as a template rather than a gap", () => {
    expect(fill("{a} and {b}", { a: "1" })).toBe("1 and {b}");
  });
});
