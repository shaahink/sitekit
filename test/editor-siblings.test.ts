/* The other language of this page.
   ---------------------------------------------------------------------------
   The rule has to hold on the fleet as it actually is, not on ids invented to
   suit it — so the entry sets below were read off the seven checkouts on
   2026-07-31 with

     find <site>/src/content -name '*.yaml' -o -name '*.yml'

   and are pinned here. Two of them have locales in their ids; five do not, and
   the assertion that this fires on exactly two of seven is the whole safety
   argument for shipping it fleet-wide with no flag. */

import { describe, expect, it } from "vitest";
import { siblingsOf, splitLocale } from "../src/editor/siblings.js";

const ref = (id: string, label = id) => ({ id, label });

/* Every entry id in the fleet, by site, measured 2026-07-31. */
const FLEET: Record<string, string[]> = {
  "elfine-site": [
    "about.en",
    "about.fr",
    "dramaturgy.en",
    "dramaturgy.fr",
    "home.en",
    "home.fr",
    "site.en",
    "site.fr",
    "upcoming.en",
    "upcoming.fr",
    "visual.en",
    "visual.fr",
    "works.en",
    "works.fr",
    "workshops.en",
    "workshops.fr"
  ],
  nimagiti: ["home.en", "home.fa"],
  "behrooz-website": [
    "about",
    "home",
    "showcase",
    "behnam",
    "behrouz",
    "shayan",
    "canvases",
    "in-the-open",
    "works-on-paper",
    "forgotten",
    "wordless"
  ],
  "shade-site": [
    "404",
    "home",
    "work",
    "01-100kolah",
    "02-tailoring",
    "03-moving-pictures",
    "04-shadow-game",
    "05-red-thread",
    "site"
  ],
  "mosleh-clinic": [
    "childhood-grommets",
    "endoscopic-sinus-surgery",
    "glue-ear",
    "mastoid-surgery",
    "microlaryngoscopy-oesophagoscopy",
    "parotid-surgery",
    "rhinoplasty",
    "sinusitis",
    "snoring-sleep-apnoea",
    "submandibular-gland-surgery",
    "maryam-mosleh",
    "mohammad-taghi-mosleh",
    "about",
    "contact",
    "doctors",
    "education",
    "home",
    "services",
    "corrective",
    "ent",
    "facial",
    "massage",
    "skin",
    "site"
  ],
  "sk-studio": ["engineering", "home", "request", "bez", "elfine", "nimagiti", "shade"],
  "site-template": ["home"]
};

describe("splitLocale", () => {
  it("splits a locale off the end of an entry id", () => {
    expect(splitLocale("home.en")).toEqual({ stem: "home", locale: "en" });
    expect(splitLocale("home.fa")).toEqual({ stem: "home", locale: "fa" });
    expect(splitLocale("workshops.fr")).toEqual({ stem: "workshops", locale: "fr" });
  });

  it("takes a region tag with it", () => {
    expect(splitLocale("home.pt-br")).toEqual({ stem: "home", locale: "pt-br" });
    expect(splitLocale("home.zh-hant")).toEqual({ stem: "home", locale: "zh-hant" });
  });

  it("takes the last dot, so a stem may have one", () => {
    expect(splitLocale("news.2026.en")).toEqual({ stem: "news.2026", locale: "en" });
  });

  it("refuses a final segment that is not language-shaped", () => {
    /* The reason the pattern exists at all: without it `v1.2-notes` would be
       "the page in 2-notes" and an owner would be offered a language nobody
       speaks. */
    expect(splitLocale("v1.2-notes")).toBeNull();
    expect(splitLocale("01-100kolah")).toBeNull();
    expect(splitLocale("notes.yaml")).toBeNull();
    expect(splitLocale("home.")).toBeNull();
    expect(splitLocale(".en")).toBeNull();
    expect(splitLocale("home")).toBeNull();
  });
});

describe("siblingsOf", () => {
  it("finds the French half of an English page", () => {
    const entries = [ref("home.en", "English"), ref("home.fr", "Français")];
    expect(siblingsOf("home.en", entries)).toEqual([ref("home.fr", "Français")]);
    expect(siblingsOf("home.fr", entries)).toEqual([ref("home.en", "English")]);
  });

  it("carries the site's own label, not a name the kit invented", () => {
    /* elfine's schema says "Français" and nimagiti's says "فارسی"; the panel
       and this line have to agree, because they are the same safeguard. */
    const [only] = siblingsOf("home.en", [ref("home.en", "English"), ref("home.fa", "فارسی")]);
    expect(only?.label).toBe("فارسی");
  });

  it("carries a url when the site declared one", () => {
    const entries = [
      { id: "home.en", label: "English", url: "/" },
      { id: "home.fr", label: "Français", url: "/fr/" }
    ];
    expect(siblingsOf("home.en", entries)[0]?.url).toBe("/fr/");
  });

  it("finds two other languages when there are two", () => {
    const entries = [ref("home.en"), ref("home.fr"), ref("home.fa")];
    expect(siblingsOf("home.en", entries).map((entry) => entry.id)).toEqual(["home.fr", "home.fa"]);
  });

  it("never offers the page you are on", () => {
    const entries = [ref("home.en"), ref("home.fr")];
    expect(siblingsOf("home.en", entries).some((entry) => entry.id === "home.en")).toBe(false);
  });

  it("does not cross stems", () => {
    /* elfine's `works` collection holds only `works.en`/`works.fr`, but a
       collection that held two stems must not offer the About page as the
       other language of the Home one. */
    const entries = [ref("home.en"), ref("home.fr"), ref("about.en"), ref("about.fr")];
    expect(siblingsOf("home.en", entries).map((entry) => entry.id)).toEqual(["home.fr"]);
  });

  it("is silent for an entry with no locale in its id", () => {
    expect(siblingsOf("rhinoplasty", [ref("rhinoplasty"), ref("sinusitis")])).toEqual([]);
  });

  it("is silent when nothing else shares the stem", () => {
    expect(siblingsOf("home.en", [ref("home.en"), ref("about.fr")])).toEqual([]);
  });
});

describe("the fleet as it is", () => {
  /* Each site's entries as one flat list. Real collections are narrower — the
     rule only ever sees one collection's entries — so a flat list is the
     harder case and a false positive here would be a false positive there. */
  const fires = (site: string): string[] =>
    (FLEET[site] as string[]).filter((id) => siblingsOf(id, (FLEET[site] as string[]).map((other) => ref(other))).length > 0);

  it("fires on the two bilingual sites and nowhere else", () => {
    const bilingual = Object.keys(FLEET).filter((site) => fires(site).length > 0);
    expect(bilingual.sort()).toEqual(["elfine-site", "nimagiti"]);
  });

  it("offers every one of elfine's sixteen pages its other language, and exactly one", () => {
    const entries = (FLEET["elfine-site"] as string[]).map((id) => ref(id));
    for (const id of FLEET["elfine-site"] as string[]) {
      const others = siblingsOf(id, entries);
      expect(others, id).toHaveLength(1);
      /* Same stem, other locale — pinned per id rather than asserted in the
         abstract, because "one sibling" would also be satisfied by the wrong
         one. */
      const here = splitLocale(id);
      expect(others[0]?.id).toBe(`${here?.stem}.${here?.locale === "en" ? "fr" : "en"}`);
    }
  });

  it("offers nimagiti's Farsi page its English half and back", () => {
    const entries = (FLEET["nimagiti"] as string[]).map((id) => ref(id));
    expect(siblingsOf("home.fa", entries).map((entry) => entry.id)).toEqual(["home.en"]);
    expect(siblingsOf("home.en", entries).map((entry) => entry.id)).toEqual(["home.fa"]);
  });

  it("says nothing at all on the five sites with no locale in an id", () => {
    for (const site of ["behrooz-website", "shade-site", "mosleh-clinic", "sk-studio", "site-template"]) {
      expect(fires(site), site).toEqual([]);
    }
  });

  it("is not fooled by shade's numbered project ids", () => {
    /* `01-100kolah` has no dot; `05-red-thread` has none either. The point of
       naming them is that a rule keyed on "has a dot" rather than on "ends in
       a language tag" would still be safe here and would not be safe forever,
       and this is the site most likely to grow an id that looks like one. */
    const entries = (FLEET["shade-site"] as string[]).map((id) => ref(id));
    for (const id of FLEET["shade-site"] as string[]) expect(siblingsOf(id, entries), id).toEqual([]);
  });
});
