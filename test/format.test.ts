import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildTitle,
  buildBody,
  languageName,
  trimWords,
  firstSentence,
  escapeMd,
  cell,
  stamp,
  trim,
  quote
} from "../src/feedback/format.js";
import type { FormatOptions } from "../src/feedback/format.js";

const ELFINE: FormatOptions = {
  timeZone: "Europe/Brussels",
  timestampLocale: "en-GB",
  locales: [
    { prefix: "fr", name: "French", label: "fr" },
    { prefix: "en", name: "English" }
  ]
};

describe("trimWords", () => {
  it("returns short values untouched", () => {
    expect(trimWords("Workshops", 40)).toBe("Workshops");
  });

  it("never cuts mid-word", () => {
    expect(trimWords("the quick brown fox jumps over the lazy dog", 20)).toBe("the quick brown fox…");
  });

  it("drops trailing punctuation before the ellipsis", () => {
    expect(trimWords("a series of workshops, retreats and talks", 22)).toBe("a series of workshops…");
  });

  it("collapses whitespace", () => {
    expect(trimWords("  spread \n out   words  ", 40)).toBe("spread out words");
  });
});

describe("firstSentence", () => {
  it("stops at the first sentence when it is long enough", () => {
    expect(firstSentence("This is the first sentence. And a second one.", 64)).toBe(
      "This is the first sentence"
    );
  });

  it("ignores a stop that comes suspiciously early", () => {
    expect(firstSentence("Hi. The real point comes after", 64)).toBe(
      "Hi. The real point comes after"
    );
  });

  it("still respects the length cap", () => {
    const out = firstSentence("word ".repeat(40), 30);
    expect(out.length).toBeLessThanOrEqual(31);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("escapeMd", () => {
  it("escapes markdown control characters", () => {
    expect(escapeMd("a_b*c[d]e<f>g`h")).toBe("a\\_b\\*c\\[d\\]e\\<f\\>g\\`h");
  });
});

describe("cell", () => {
  it("escapes pipes so table rows survive", () => {
    expect(cell("a|b")).toBe("a\\|b");
  });

  it("flattens newlines", () => {
    expect(cell("two\nlines")).toBe("two lines");
  });
});

describe("trim", () => {
  it("collapses whitespace and caps length with an ellipsis", () => {
    expect(trim("  a   b  ", 10)).toBe("a b");
    expect(trim("abcdefghij", 5)).toBe("abcd…");
  });

  it("treats null and undefined as empty", () => {
    expect(trim(null, 5)).toBe("");
    expect(trim(undefined, 5)).toBe("");
  });
});

describe("quote", () => {
  it("prefixes every line, leaving blank lines bare", () => {
    expect(quote("one\n\ntwo")).toBe("> one\n> \n> two");
  });
});

describe("languageName", () => {
  it("maps configured prefixes to names", () => {
    expect(languageName("fr", ELFINE.locales)).toBe("French");
    expect(languageName("fr-BE", ELFINE.locales)).toBe("French");
    expect(languageName("en-GB", ELFINE.locales)).toBe("English");
  });

  it("falls back to the raw code, then to unknown", () => {
    expect(languageName("fa", ELFINE.locales)).toBe("fa");
    expect(languageName("", ELFINE.locales)).toBe("unknown");
    expect(languageName(undefined, [])).toBe("unknown");
  });
});

describe("stamp", () => {
  it("falls back to UTC when the zone is invalid", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T12:34:00Z"));
    expect(stamp("Not/AZone", "en-GB")).toBe(new Date().toUTCString());
    vi.useRealTimers();
  });
});

describe("buildTitle", () => {
  it("leads with the section", () => {
    expect(buildTitle("The photo feels dark to me.", { section: "Workshops" }, {})).toBe(
      "Workshops: The photo feels dark to me"
    );
  });

  it("falls back to the page name", () => {
    expect(buildTitle("Lovely!", {}, { path: "/fr/" })).toBe("fr: Lovely!");
  });

  it("never returns an empty title", () => {
    expect(buildTitle("", {}, { path: "/" })).toBe("Home: ");
  });
});

describe("buildBody", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T12:34:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const full = {
    comment: "The gold feels too bright here.",
    name: "Elfine",
    page: { path: "/fr/", lang: "fr" },
    target: {
      section: "Ateliers",
      sectionId: "ateliers",
      label: "Chant du monde",
      tag: "img",
      media: "atelier.jpg",
      selector: "#ateliers > div > img"
    },
    client: { viewport: "390×844", dpr: 3, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1" },
    siteUrl: "https://elfine-site.vercel.app"
  };

  it("renders the full body with a screenshot", () => {
    const body = buildBody({ ...full, shotPath: "screenshots/2026-07-27/aa.jpg" }, ELFINE);
    expect(body).toMatchSnapshot();
  });

  it("renders without a screenshot section when there is no screenshot", () => {
    const body = buildBody({ ...full, shotPath: null }, ELFINE);
    expect(body).not.toContain("### Screenshot");
    expect(body).toMatchSnapshot();
  });

  it("drops empty rows for a whole-page note", () => {
    const body = buildBody(
      {
        comment: "Lovely overall.",
        name: "Anonymous",
        page: { path: "/", lang: "en" },
        target: {},
        client: {},
        shotPath: null,
        siteUrl: "https://elfine-site.vercel.app"
      },
      ELFINE
    );
    expect(body).toContain("| Page |");
    expect(body).not.toContain("| Section |");
    expect(body).not.toContain("| Element |");
    expect(body).not.toContain("| Screen |");
    expect(body).not.toContain("| Browser |");
    expect(body).toContain("The Home page as a whole");
  });

  it("links to the exact spot with the section anchor", () => {
    const body = buildBody({ ...full, shotPath: null }, ELFINE);
    expect(body).toContain("(https://elfine-site.vercel.app/fr/#ateliers)");
  });
});
