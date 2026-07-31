/* The credit line — one sentence, three languages, five clients' footers.
   ---------------------------------------------------------------------------
   This is the most-published string the kit emits: it is on every page of
   every site in the fleet, in whichever language that page is written in. The
   cost of getting it wrong is a deploy per site to fix, so it is worth more
   assertions than its size suggests. */

import { describe, expect, it } from "vitest";
import { creditLine, credits, creditsAnchor, creditsFor } from "../src/credits/index.js";

const base = { siteName: "Elfine Radwanski", siteUrl: "https://elfine.example/" };

describe("creditLine", () => {
  it("says it in English by default", () => {
    expect(creditLine(base)).toContain(">sk</a> made this");
  });

  it("says it in French", () => {
    expect(creditLine({ ...base, lang: "fr" })).toContain(">sk</a> a fait ce site");
  });

  it("puts the name where Persian word order puts it", () => {
    /* The whole reason this is a template rather than a suffix: in Farsi the
       name is in the middle of the sentence. Anything built by appending
       would read correctly in two languages and be wrong in the third. */
    const line = creditLine({ ...base, lang: "fa" });
    expect(line).toContain("این سایت را <a");
    expect(line).toContain(">sk</a> ساخته");
  });

  it("takes a region tag and ignores it", () => {
    expect(creditLine({ ...base, lang: "fa-IR" })).toContain("ساخته");
    expect(creditLine({ ...base, lang: "FR" })).toContain("a fait ce site");
  });

  it("does not mistake Faroese for Farsi", () => {
    /* `fao` starts with `fa`. A prefix match here would put a Persian sentence
       on a Faroese page — the same bug the editor's tables were careful about,
       in a second place. */
    expect(creditLine({ ...base, lang: "fao" })).toContain("made this");
  });

  it("falls back to English rather than to nothing", () => {
    /* An unknown language showing an English credit is a small oddity. One
       showing an empty span has silently dropped the acquisition channel the
       whole module exists for. */
    expect(creditLine({ ...base, lang: "de" })).toContain("made this");
    expect(creditLine({ ...base, lang: "" })).toContain("made this");
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
    expect(html).toContain("a fait ce site");
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
