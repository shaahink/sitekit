/* The class-name contract, enforced against the file it describes.
   ---------------------------------------------------------------------------
   Six sites style this widget from their own `feedback-chrome.css`. That makes
   every class name the chrome writes a published interface across six repos,
   and the failure mode of breaking it is the quiet kind: an unstyled review
   widget still works, so no build goes red and nobody learns until a reviewer
   opens a client's page and finds a stack of browser-default buttons.

   So the contract in `classes.ts` is not a comment. This reads `chrome.ts`
   back and refuses any `rv-`/`is-` class the chrome uses that the contract
   does not list, and any name the contract lists that the chrome no longer
   writes. Same shape as `checkAnnotations` reading the built pages: measure
   the artifact, do not trust the prose next to it.

   Reading source text rather than mounting the DOM is deliberate. The kit has
   no browser environment in its test suite — the widget's DOM is verified in a
   real browser through sk-platform's harness — and a text scan is the only
   check here that would catch a rename in a branch nobody exercised. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WIDGET_CLASSES, WIDGET_STATE_CLASSES } from "../src/widget/classes.js";

const chrome = readFileSync(fileURLToPath(new URL("../src/widget/chrome.ts", import.meta.url)), "utf8");

/* Class names as the chrome writes them: `el("div", "rv-root")`,
   `classList.add("is-picking")`, `"rv-ghost rv-copy"`, `querySelector(".rv-copy")`.
   Only string literals are scanned, so the file's own prose about `.rv-root`
   in a comment cannot vote. */
function classesIn(source: string): Set<string> {
  const found = new Set<string>();
  for (const [, literal] of source.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
    for (const [, name] of literal!.matchAll(/\.?\b((?:rv|is)-[a-z-]+)\b/g)) {
      found.add(name!);
    }
  }
  return found;
}

describe("the widget's class-name contract", () => {
  const declared = new Set([...WIDGET_CLASSES, ...WIDGET_STATE_CLASSES]);
  const used = classesIn(chrome);

  it("finds the classes at all — a scan that matches nothing must not pass", () => {
    expect(used.size).toBeGreaterThan(25);
    expect(used.has("rv-root")).toBe(true);
  });

  it("declares every class the chrome writes", () => {
    const undeclared = [...used].filter((name) => !declared.has(name)).sort();
    expect(undeclared, "used by chrome.ts, missing from classes.ts").toEqual([]);
  });

  it("writes every class it declares", () => {
    const unused = [...declared].filter((name) => !used.has(name)).sort();
    expect(unused, "declared in classes.ts, not written by chrome.ts").toEqual([]);
  });

  it("keeps the two lists apart", () => {
    const both = WIDGET_CLASSES.filter((name) => WIDGET_STATE_CLASSES.includes(name));
    expect(both).toEqual([]);
  });

  it("prefixes every structural name, which is what keeps a site's CSS scoped", () => {
    expect(WIDGET_CLASSES.filter((name) => !name.startsWith("rv-"))).toEqual([]);
  });
});
