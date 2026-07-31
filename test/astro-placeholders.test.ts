/* The placeholder gate.
   ---------------------------------------------------------------------------
   Two things are being pinned here, and the second one matters as much as the
   first.

   That it *catches* the case it was built for: `hello@elfine.example`, in an
   ordinary editable field, on every page of a live client's site since the day
   it was built, invisible to the build, the editor and the review widget.

   And that it does not catch anything else. A gate that is wrong on real
   content is a gate somebody switches off, and the fleet's own content is full
   of strings a lazier pattern would refuse — Persian prose, an article about
   sinusitis, a project called `05-red-thread`, an address at a real domain.
   Half the tests below are about what stays quiet. */

import { describe, expect, it } from "vitest";
import { allowsPath, checkEntry, entriesOnDisk, findPlaceholders } from "../src/astro/placeholders.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const none = () => false;
const found = (values: unknown) => checkEntry("site/site.en", values, none);

describe("what counts as a placeholder", () => {
  it("catches the address this whole gate exists for", () => {
    const problems = found({ contact: { email: "hello@elfine.example" } });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.path).toBe("contact.email");
    expect(problems[0]?.value).toBe("hello@elfine.example");
    expect(problems[0]?.why).toContain("reserved domain");
  });

  it("catches the reserved second-level domains", () => {
    for (const value of ["a@example.com", "https://example.org/x", "example.net", "me@EXAMPLE.EDU"]) {
      expect(found({ x: value }), value).toHaveLength(1);
    }
  });

  it("catches filler text, a note left behind, and a row of x's", () => {
    expect(found({ x: "Lorem ipsum dolor sit amet" })).toHaveLength(1);
    expect(found({ x: "TODO: write this" })).toHaveLength(1);
    expect(found({ x: "FIXME" })).toHaveLength(1);
    expect(found({ x: "call us on xxx" })).toHaveLength(1);
  });

  it("reports one verdict per field, not one per pattern", () => {
    /* A string that trips two patterns is still one thing to fix, and two rows
       would make the list read as twice the problem it is. */
    expect(found({ x: "TODO: lorem ipsum at example.com" })).toHaveLength(1);
  });

  it("finds it however deep, with the path that reaches it", () => {
    const problems = found({
      sections: [{ rows: [{ link: "https://example.com" }, { link: "https://elfine.fr" }] }]
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.path).toBe("sections[0].rows[0].link");
  });

  it("prints the exact line that would allow it", () => {
    /* The ergonomic half of the escape: a refusal that makes somebody go and
       work out the syntax is a refusal that gets the gate deleted instead. */
    const problems = found({ sections: [{ rows: [{ link: "https://example.com" }] }] });
    expect(problems[0]?.escape).toBe("site:sections[].rows[].link");
  });
});

describe("what stays quiet", () => {
  const quiet = (values: unknown, why: string) => {
    expect(found(values), why).toEqual([]);
  };

  it("leaves real addresses alone", () => {
    quiet({ a: "hello@elfine.fr", b: "info@moslehclinic.com", c: "bruce@bez.works" }, "real domains");
  });

  it("leaves words that merely contain the patterns alone", () => {
    /* `\b` on all of them, and this is the test that says why: "exemplary",
       "exampled", a Latin-looking surname, and a file named with an x. */
    quiet(
      {
        a: "an exemplary performance",
        b: "Explored, exampled and abandoned",
        c: "Lorenzo Fiorentino",
        d: "The Boxxx Ensemble",
        e: "photo-xx.jpg"
      },
      "words containing a pattern"
    );
  });

  it("leaves lower-case notes alone", () => {
    /* An article about a to-do list is ordinary content. Only the shouted
       form is a note somebody left themselves. */
    quiet({ a: "Make a todo list before the appointment", b: "tbd is a strange word" }, "lower case");
  });

  it("leaves Persian and French prose alone", () => {
    quiet(
      {
        fa: "جراحی بینی یکی از رایج‌ترین عمل‌های زیبایی است — ۱۲۳ بیمار در سال گذشته",
        fr: "Une artiste interdisciplinaire à l’écoute de la différence",
        en: "Five projects, each of which took a year"
      },
      "real prose in three languages"
    );
  });

  it("leaves numbers, booleans and empty strings alone", () => {
    quiet({ w: 1600, h: 900, visible: true, alt: "", nothing: null }, "non-strings");
  });

  it("leaves shade's numbered project ids and mosleh's slugs alone", () => {
    quiet(
      { a: "05-red-thread", b: "snoring-sleep-apnoea", c: "microlaryngoscopy-oesophagoscopy" },
      "real slugs"
    );
  });
});

describe("the escape", () => {
  it("allows one path in a collection, across every entry of it", () => {
    /* Collection-wide is the shape a bilingual site needs: the same field is
       the same field in both languages, and having to allow it twice is how a
       site ends up allowing it with a wildcard instead. */
    expect(allowsPath(["site:contact.email"], "site/site.en", "contact.email")).toBe(true);
    expect(allowsPath(["site:contact.email"], "site/site.fr", "contact.email")).toBe(true);
  });

  it("allows one entry alone when it is spelled that way", () => {
    expect(allowsPath(["site/site.fr:contact.email"], "site/site.fr", "contact.email")).toBe(true);
    expect(allowsPath(["site/site.fr:contact.email"], "site/site.en", "contact.email")).toBe(false);
  });

  it("folds indices, so a list is allowed once", () => {
    expect(allowsPath(["works:rows[].link"], "works/works.en", "rows[3].link")).toBe(true);
  });

  it("allows exactly one row when the index is spelled out", () => {
    expect(allowsPath(["works:rows[2].link"], "works/works.en", "rows[2].link")).toBe(true);
    expect(allowsPath(["works:rows[2].link"], "works/works.en", "rows[3].link")).toBe(false);
  });

  it("allows nothing it was not asked to", () => {
    expect(allowsPath(["site:contact.email"], "site/site.en", "contact.phone")).toBe(false);
    expect(allowsPath(["site:contact.email"], "about/about.en", "contact.email")).toBe(false);
    expect(allowsPath([], "site/site.en", "contact.email")).toBe(false);
  });

  it("takes a value out of the refusal when it is allowed", () => {
    const problems = checkEntry("site/site.en", { contact: { email: "hello@elfine.example" } }, (path) =>
      allowsPath(["site:contact.email"], "site/site.en", path)
    );
    expect(problems).toEqual([]);
  });
});

describe("over a checkout", () => {
  const schema = z.object({});

  function site(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "sk-placeholders-"));
    for (const [path, text] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, text, "utf8");
    }
    return root;
  }

  it("reads a single-file collection and a directory one", () => {
    const root = site({
      "src/content/site.yaml": 'contact:\n  email: "hello@elfine.example"\n',
      "src/content/pages/home.yaml": 'hero:\n  title: "Real words"\n',
      "src/content/pages/about.yaml": 'hero:\n  title: "TODO"\n',
      "src/content/pages/notes.md": "TODO not content"
    });
    const { problems, entries } = findPlaceholders(
      { site: { schema, file: "src/content/site.yaml" }, pages: { schema, dir: "src/content/pages" } },
      root
    );
    expect(entries).toBe(3);
    expect(problems.map((problem) => `${problem.entry} ${problem.path}`).sort()).toEqual([
      "pages/about hero.title",
      "site/site contact.email"
    ]);
  });

  it("names entries the way listEntries does, so the escape can be pasted", () => {
    const root = site({ "src/content/pages/home.en.yaml": 'a: "example.com"\n' });
    const { problems } = findPlaceholders({ pages: { schema, dir: "src/content/pages" } }, root);
    expect(problems[0]?.entry).toBe("pages/home.en");
    expect(problems[0]?.escape).toBe("pages:a");
  });

  it("honours the allow list against real files", () => {
    const root = site({ "src/content/site.yaml": 'contact:\n  email: "hello@elfine.example"\n' });
    const config = { site: { schema, file: "src/content/site.yaml" } };
    expect(findPlaceholders(config, root).problems).toHaveLength(1);
    expect(findPlaceholders(config, root, ["site:contact.email"]).problems).toEqual([]);
  });

  it("stays quiet about a collection whose directory is not there", () => {
    /* A missing content directory is a real fault and it is one the build and
       the annotation checker both already report. A third voice here would
       make this gate's output about something other than placeholders. */
    const root = site({ "src/content/pages/home.yaml": 'a: "ok"\n' });
    expect(entriesOnDisk({ schema, dir: "src/content/nothing" }, root)).toEqual([]);
    expect(findPlaceholders({ gone: { schema, dir: "src/content/nothing" } }, root).entries).toBe(0);
  });

  it("takes .yml as well as .yaml, because listEntries does", () => {
    const root = site({ "src/content/pages/home.yml": 'a: "TODO"\n' });
    expect(findPlaceholders({ pages: { schema, dir: "src/content/pages" } }, root).problems).toHaveLength(
      1
    );
  });
});
