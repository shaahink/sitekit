/* The hashes that switch off the sign-in stylesheet.
   ---------------------------------------------------------------------------
   The fixture is not written, it is downloaded: `skworks-edit-0.15.0.html` is
   the live sk-works /edit page as it was served on 2026-07-30, the page whose
   CSP a real browser reported a violation against on the same day. So the
   assertions below are about a policy a site actually shipped, and the
   before/after is the field's own bytes rather than a reconstruction. */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { relaxStylePolicy } from "../src/astro/style-policy.js";

const LIVE = readFileSync(join(import.meta.dirname, "fixtures/skworks-edit-0.15.0.html"), "utf8");

const styleElem = (html: string): string => {
  const content = /content="([^"]*)"/.exec(/<meta[^>]*content-security-policy[^>]*>/i.exec(html)![0])![1]!;
  return content.split(";").find((directive) => directive.trim().startsWith("style-src-elem"))!.trim();
};

describe("relaxStylePolicy", () => {
  it("drops the build's hashes from the page sk-works actually served", () => {
    expect(styleElem(LIVE)).toContain("'sha256-");
    const result = relaxStylePolicy(LIVE);
    expect(result.removed).toHaveLength(3);
    expect(styleElem(result.html)).toBe(
      "style-src-elem 'self' 'unsafe-inline' https://accounts.google.com"
    );
  });

  it("leaves every other directive on that page untouched, hashes and all", () => {
    const before = LIVE.split(";").filter((directive) => !directive.includes("style-src-elem"));
    const after = relaxStylePolicy(LIVE).html.split(";").filter((d) => !d.includes("style-src-elem"));
    expect(after).toEqual(before);
    /* script-src's eight hashes are the site's own and are load-bearing. */
    expect(relaxStylePolicy(LIVE).html).toContain("'sha256-WZRJfWvsnNCPcxzZwvyhovnZGqhZaC+8gPGPRbx6wTk='");
  });

  it("is idempotent, so it can run over every build", () => {
    const once = relaxStylePolicy(LIVE).html;
    const twice = relaxStylePolicy(once);
    expect(twice.removed).toEqual([]);
    expect(twice.html).toBe(once);
  });

  it("does nothing to a page with no hashes in that directive — four of six sites", () => {
    const elfine = LIVE.replace(/ 'sha256-[^']*'/g, "");
    expect(relaxStylePolicy(elfine)).toMatchObject({ html: elfine, removed: [] });
  });

  it("does nothing where there is no policy at all, or no such directive", () => {
    expect(relaxStylePolicy("<html><head></head></html>").removed).toEqual([]);
    const noElem = LIVE.replace(/style-src-elem[^;]*;/, "style-src 'self' 'sha256-abc';");
    expect(relaxStylePolicy(noElem).removed).toEqual([]);
  });

  it("does nothing where the directive has hashes but never asked for unsafe-inline", () => {
    /* Removing them there would widen a policy nobody widened on purpose. */
    const strict = LIVE.replace("'unsafe-inline' https://accounts.google.com", "https://accounts.google.com");
    expect(relaxStylePolicy(strict).removed).toEqual([]);
  });

  /* The one case where a hash in that directive might be doing real work. The
     route's own markup has no inline style, so arriving here means the kit or
     Astro changed — and guessing which hash belongs to the <style> is worse
     than saying so in the build log. */
  it("refuses, rather than guessing, when the page carries an inline style", () => {
    const withStyle = LIVE.replace("</head>", "<style>body{margin:0}</style></head>");
    const result = relaxStylePolicy(withStyle);
    expect(result.html).toBe(withStyle);
    expect(result.removed).toEqual([]);
    expect(result.refused).toContain("3 style hashes");
    expect(result.refused).toContain("blocked");
  });

  /* A policy carries single quotes, so its attribute is double-quoted in any
     valid document — Astro writes it that way and so does this. */
  it("takes a lone hash out and leaves the directives around it alone", () => {
    const html =
      `<meta http-equiv="Content-Security-Policy" ` +
      `content="style-src-elem 'self' 'unsafe-inline' 'sha384-abc'; img-src *"><p>hi</p>`;
    const result = relaxStylePolicy(html);
    expect(result.removed).toEqual(["'sha384-abc'"]);
    expect(result.html).toContain(`content="style-src-elem 'self' 'unsafe-inline'; img-src *"`);
  });
});
