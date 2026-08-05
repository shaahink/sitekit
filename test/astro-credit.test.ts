/* The credit component, and the promise that taking this release changes nothing.
   ---------------------------------------------------------------------------
   `Credit.astro` cannot be imported by a test: it is published as source and
   compiled by each adopting site's own Astro build, which is the entire reason
   it can inherit that site's CSP and asset pipeline. So what is asserted here
   is split in two, and both halves are real.

   **The half that is executable** is the credit itself. `creditsFor()` is on
   every page of every site in the fleet and this release must not move a byte
   of it, so it is pinned to a literal rather than to a shape — a `toContain`
   would have passed on every change worth catching.

   **The half that is not** is the component's source, read as text. That is a
   weaker assertion than running it and it is stronger than nothing, and the
   two things it guards are exactly the two that fail silently: a static import
   of the companion would put the whole module on the critical path of every
   page of somebody's site and look identical in a browser, and a "tidied" link
   would send a client's visitor away from the client's site in their own tab.
   Neither shows up in a build, in a type, or on a screen. */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  creditHref,
  creditLine,
  creditsAnchor,
  creditsFor,
  creditsJsonLd
} from "../src/credits/index.js";

const base = { siteName: "Azarnoosh Hs", siteUrl: "https://azarnoosh.vercel.app/" };

const source = readFileSync(new URL("../src/astro/Credit.astro", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const copier = readFileSync(new URL("../scripts/copy-assets.mjs", import.meta.url), "utf8");

describe("a bump alone changes nothing on a client's site", () => {
  it("creditsFor is byte-for-byte what it was", () => {
    /* Written out rather than snapshotted, because a snapshot is a file
       somebody updates when it goes red and this is a string that four live
       footers are serving right now. If this assertion has to change, the
       change is a deploy per site and it is a decision, not a fix. */
    expect(creditsFor(base)).toBe(
      '<span class="sk-creditline" lang="en" dir="ltr">' +
        '<a class="sk-credit" href="https://sk-works.vercel.app" target="_blank"' +
        ' rel="author noopener">sk</a> made this</span>' +
        '<script type="application/ld+json">' +
        '{"@context":"https://schema.org","@type":"WebSite","name":"Azarnoosh Hs",' +
        '"url":"https://azarnoosh.vercel.app/","creator":' +
        '{"@type":"Organization","name":"sk","url":"https://sk-works.vercel.app"}}' +
        "</script>"
    );
  });

  it("and the component's two halves are that same string, split", () => {
    /* The companion path renders `creditLine` and `creditsJsonLd` separately so
       the character's mount can sit between them inside the positioned wrapper.
       This is the assertion that they are still the whole of the credit: a site
       that adopts the companion is serving the same markup as one that did
       not, plus one empty span. */
    expect(creditLine(base) + creditsJsonLd(base)).toBe(creditsFor(base));
  });

  it("the new tab survives, and noreferrer is still absent", () => {
    /* Both rulings are older than this release and neither is being revisited:
       a visitor who taps a footer credit has not decided to leave, and the
       referrer is how we learn which client's site sent somebody. */
    expect(creditsAnchor(base)).toContain('target="_blank"');
    expect(creditsAnchor(base)).toContain('rel="author noopener"');
    expect(creditsAnchor(base)).not.toContain("noreferrer");
  });
});

describe("creditHref", () => {
  it("is where the credit points, default applied", () => {
    expect(creditHref()).toBe("https://sk-works.vercel.app");
    expect(creditHref({ href: "https://elsewhere.example" })).toBe("https://elsewhere.example");
  });

  it("is the same answer the anchor and the JSON-LD give", () => {
    /* The reason it is exported at all: the companion's one line is an offer to
       visit the place the credit names, and two reads of the same fallback are
       two places a footer's destination is decided. */
    for (const options of [base, { ...base, href: "https://elsewhere.example" }]) {
      expect(creditsAnchor(options)).toContain(`href="${creditHref(options)}"`);
      expect(creditsJsonLd(options)).toContain(`"url":"${creditHref(options)}"`);
    }
  });
});

describe("Credit.astro", () => {
  it("is published — in the export map and in the copier", () => {
    /* The same trap `exports.test.ts` exists for, in the one shape that file
       cannot cover: an .astro file is not importable by specifier from a test,
       so reachability has to be read off the two places that decide it. tsc
       does not know this format, so without the copier line the export map
       points at a file that is never built. */
    expect(pkg.exports["./astro/Credit.astro"]).toBe("./dist/astro/Credit.astro");
    expect(copier).toContain('["src/astro/Credit.astro", "dist/astro/Credit.astro"]');
  });

  it("keeps the companion off the critical path", () => {
    /* §8.2's number is zero, and this is the line that decides it. A static
       import compiles, works, and puts the rig, the lines and every frame of
       behaviour into the bundle every page of a client's site downloads before
       first paint. The dynamic one is fetched after `load` and after the
       browser reports itself idle — `motion/boot.ts` rule 1. */
    expect(source).toContain('await import("@shaahink/sitekit/companion")');
    expect(source).not.toMatch(/import\s*{[^}]*}\s*from\s*"@shaahink\/sitekit\/companion"/);
  });

  it("sends the offer to a new tab, and keeps the referrer", () => {
    expect(source).toContain('target: "_blank"');
    expect(source).toContain('rel: "author noopener"');
    /* Read off the value rather than the file, because the file *says* the word
       — the comment explaining why it is absent is the thing most likely to
       stop somebody adding it, and an assertion that forbade the explanation
       would be an assertion that got the comment deleted. */
    expect(source).not.toMatch(/rel[:=]\s*"[^"]*noreferrer/);
  });

  it("names no colour and no font of its own", () => {
    /* He is drawn in `currentColor` and measured in `em` off the credit line,
       so a client's own footer styling is the whole of his palette and his
       scale. The style block this component ships is two declarations of
       layout; anything else in it would be the kit deciding how somebody
       else's footer looks. */
    /* Anchored at the start of a line, because the header comment names
       `<style>` while explaining who hashes it and a lazy match would read the
       prose as the stylesheet. */
    const block = /^<style>$([\s\S]*?)^<\/style>$/m.exec(source)?.[1] ?? "";
    expect(block).toContain("position: relative");
    /* The declarations, with the argument for them stripped out. The comment in
       there says the words "no colour" and "no font" and would otherwise fail
       the assertion it exists to explain. */
    const style = block.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(style).not.toMatch(/\b(color|font|font-size|background)\s*:/);
  });
});
