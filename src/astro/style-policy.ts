/* The sign-in stylesheet that a site's own hashes silently switch off.
   ---------------------------------------------------------------------------
   Measured in a real browser on 2026-07-30, on every live editor page in the
   fleet. The hash count in `style-src-elem`, and whether a violation was
   raised:

     nimagiti  6   blocked      sk-works  3   blocked
     bez       3   blocked      shade     1   blocked
     site-template 1 blocked    elfine    0   clean

   "Applying inline style violates the following Content Security Policy
   directive 'style-src-elem …'. Note that 'unsafe-inline' is ignored if either
   a hash or nonce value is present" — Chrome naming the mechanism itself.

   Which corrects the finding that filed this: it read as sk-works' peculiarity
   ("sk-works is such a site and elfine is not") and the opposite is true. Five
   of six were degraded and elfine is the exception. A site gets hashes the
   moment anything in its build produces a processed inline style, which is not
   a property anybody chose per site — so this was never going to stay rare.

   What is blocked is not the stylesheet Google *links* — the route names
   `https://accounts.google.com` and that load succeeds. It is the 9.7 kB
   `<style>` element Google Identity Services injects into the document at
   runtime, which only `'unsafe-inline'` could ever have covered, and which
   CSP ignores the moment a hash appears in the same directive.

   The hashes are not this page's. Astro collects every processed style's hash
   for the build and writes them into whichever style directive the page ends
   up with — and inserting any element-kind resource, which the route must do
   to name Google's origin at all, moves the page from `style-src` to
   `style-src-elem` and takes the hashes along. The built editor page contains
   no `<style>` element and exactly two stylesheets: its own panel CSS under
   `'self'` and Google's under the named origin. So on a site with hashes, the
   only effect those tokens have on this page is to disable the one source the
   route asked for.

   Hence the surgery, and its limit. Where the page has no inline style at all,
   every hash in that directive is provably dead and dropping them makes the
   policy mean what the route declared it to mean. Where the page *does* carry
   one — which the route's own markup never does, so it would mean the kit or
   Astro has changed — the hashes may be protecting something real, and this
   says so in the build log instead of quietly widening a policy.

   Why a build-time rewrite rather than a smaller fix: there isn't one.
   `Astro.csp` only ever adds sources, hashing what Google injects is not
   possible from outside Google, and the alternative — refusing to build —
   would stop a site shipping its public pages over the appearance of a button
   on an admin page. The degradation was invisible; that is what had to end. */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The marker the injected editor page puts on its root. Nothing else in a
    site has it, which is what makes the built page findable without knowing
    the route pattern or the site's `build.format`. */
const MARKER = "data-sk-editor";

const META = /<meta\b[^>]*http-equiv=["']?content-security-policy["']?[^>]*>/i;
const CONTENT = /\bcontent=("([^"]*)"|'([^']*)')/i;
const HASH = /^'(sha256|sha384|sha512)-[^']*'$/;

export interface PolicyRewrite {
  html: string;
  /** The hash tokens taken out of `style-src-elem`. */
  removed: string[];
  /** Set when the combination is there but removing the hashes would not be
      safe — nothing is rewritten in that case. */
  refused?: string;
}

/** Drops the build's style hashes from one built editor page's
    `style-src-elem`, where they are dead tokens disabling `'unsafe-inline'`.
    A page without the combination comes back untouched, so this is safe to run
    over every build and on every site. */
export function relaxStylePolicy(html: string): PolicyRewrite {
  const unchanged: PolicyRewrite = { html, removed: [] };

  const meta = META.exec(html);
  if (!meta) return unchanged;
  const attribute = CONTENT.exec(meta[0]);
  const policy = attribute?.[2] ?? attribute?.[3];
  if (policy === undefined) return unchanged;

  const directives = policy.split(";");
  const index = directives.findIndex((directive) => directive.trim().split(/\s+/)[0] === "style-src-elem");
  if (index === -1) return unchanged;

  const tokens = directives[index]!.trim().split(/\s+/);
  if (!tokens.includes("'unsafe-inline'")) return unchanged;
  const removed = tokens.filter((token) => HASH.test(token));
  if (!removed.length) return unchanged;

  /* The one case where a hash in this directive might be doing real work. */
  if (/<style\b/i.test(html)) {
    return {
      ...unchanged,
      refused:
        `carries ${removed.length} style hash${removed.length === 1 ? "" : "es"} and an inline <style>, ` +
        "so 'unsafe-inline' is ignored there and the Google sign-in stylesheet will be blocked. " +
        "The hashes were left alone because one of them may belong to that <style>."
    };
  }

  /* The original spacing is kept rather than normalised: this rewrites a file
     somebody may diff against another build, and a moved space would be a
     difference to explain. */
  const original = directives[index]!;
  const leading = original.slice(0, original.length - original.trimStart().length);
  directives[index] = leading + tokens.filter((token) => !HASH.test(token)).join(" ");
  const rewritten = directives.join(";");
  return {
    html: html.replace(meta[0], meta[0].replace(policy, rewritten)),
    removed
  };
}

interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
}

/** Applies the rewrite to whichever built pages are the editor's. Reads the
    files back rather than trusting the write, on the same terms as everything
    else the kit generates. */
export function settleStylePolicy(dir: URL, logger: Logger): void {
  const out = fileURLToPath(dir);
  for (const page of editorPages(out)) {
    const file = join(out, page);
    const result = relaxStylePolicy(readFileSync(file, "utf8"));
    if (result.refused) {
      logger.warn(`${page} ${result.refused}`);
      continue;
    }
    if (!result.removed.length) continue;

    writeFileSync(file, result.html);
    const again = relaxStylePolicy(readFileSync(file, "utf8"));
    if (again.removed.length) {
      logger.warn(`${page} still carries style hashes after the rewrite — the sign-in stylesheet is blocked there`);
      continue;
    }
    logger.info(
      `${page}: dropped ${result.removed.length} build-wide style hash${result.removed.length === 1 ? "" : "es"} ` +
        "from style-src-elem, which were switching off the 'unsafe-inline' Google's sign-in stylesheet needs"
    );
  }
}

/** Built pages carrying the editor's root marker. Forward-slashed, because
    Windows `readdir` hands back backslashes and these are printed. */
function editorPages(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((entry) => entry.split("\\").join("/"))
    .filter((entry) => entry.endsWith(".html"))
    .filter((entry) => readFileSync(join(dir, entry), "utf8").includes(MARKER));
}
