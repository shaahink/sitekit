/* The credit line — one sentence, English, six clients' footers.
   ---------------------------------------------------------------------------
   This is the most-published string the kit emits: it is on every page of
   every site in the fleet, and since 0.24.0 it is the same sentence on all of
   them whatever language the page is written in. The cost of getting it wrong
   is a deploy per site to fix, so it is worth more assertions than its size
   suggests. */

import { describe, expect, it } from "vitest";
import { creditLine, credits, creditsAnchor, creditsFor } from "../src/credits/index.js";

const base = { siteName: "Elfine Radwanski", siteUrl: "https://elfine.example/" };

describe("creditLine", () => {
  it("says it in English", () => {
    expect(creditLine(base)).toContain(">sk</a> made this");
  });

  it("says it in English on a page that is not", () => {
    /* The whole of 0.24.0, and the reason it is worth six assertions rather
       than one: every one of these was a different sentence a release ago, and
       two of them are on live client pages right now. A translation coming
       back would be a regression somebody has to spend six deploys to undo. */
    for (const lang of ["fr", "fa", "fa-IR", "FR", "de", "fao", ""]) {
      const line = creditLine({ ...base, lang });
      expect(line, lang).toContain(">sk</a> made this");
    }
  });

  it("leaves no Persian or French behind in the module at all", () => {
    /* Asserted on the output rather than on the source, because a table that
       is merely unreachable is a table somebody re-reaches. The two strings
       that were on mosleh's 21 pages and elfine's French pages: gone. */
    const every = ["fa", "fr", "en", undefined].map((lang) =>
      lang === undefined ? creditLine(base) : creditLine({ ...base, lang })
    );
    for (const line of every) {
      expect(line).not.toContain("ساخته");
      expect(line).not.toContain("a fait ce site");
    }
  });

  it("declares the language it is in, on pages that are in another", () => {
    /* An English sentence in a Farsi footer. The Latin glyphs lay themselves
       out correctly without help; the declaration is for a screen reader,
       which should switch voice rather than spell three English words in
       Persian. */
    expect(creditLine({ ...base, lang: "fa" })).toContain('lang="en"');
    expect(creditLine({ ...base, lang: "fa" })).toContain('dir="ltr"');
  });

  it("still keeps the class hook the sites style", () => {
    /* Six stylesheets have a rule for this class. A change to the sentence
       must not become a change to the selector. */
    expect(creditLine(base)).toContain('class="sk-creditline"');
  });
});

describe("the anchor inside it", () => {
  it("opens in a new tab without handing over a window", () => {
    const html = creditsAnchor(base);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="author noopener"');
  });

  it("keeps the referrer, because that is what the link is for", () => {
    expect(creditsAnchor(base)).not.toContain("noreferrer");
  });

  it("still points at the studio by default", () => {
    expect(creditsAnchor(base)).toContain('href="https://sk-works.vercel.app"');
  });

  it("escapes a label rather than letting it become markup", () => {
    const html = creditsAnchor({ ...base, label: '"><script>x</script>' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
});

describe("what a footer embeds", () => {
  it("pairs the sentence with the schema.org claim", () => {
    const html = creditsFor({ ...base, lang: "fr" });
    expect(html).toContain("made this");
    expect(html).toContain('"@type":"WebSite"');
    expect(html).toContain('"creator"');
  });

  it("still exports the old pair, so an unconverted site keeps working", () => {
    /* Seven repos move on their own commits. A kit release that broke the four
       it had not yet reached would be the worst possible way to ship a change
       to a footer. */
    expect(credits(base)).toContain("<a class=\"sk-credit\"");
    expect(credits(base)).toContain("application/ld+json");
  });
});
