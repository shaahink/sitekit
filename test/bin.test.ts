import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/* The commands a site runs, and the one thing a unit test can say about them.
   ---------------------------------------------------------------------------
   What these files *do* is proven by running them against the six real sites
   and reading the output back — `npm run proof` does it for site-template, and
   a fleet-wide pass is in session 9.5. What no site would catch quickly is the
   registration going wrong: a bin file that ships without a name is invisible
   until somebody's `npm run headers` fails, and `files: ["dist","bin"]` means
   the file itself is published either way, so nothing else notices.

   Both directions are checked, because both have nearly happened: a name
   pointing at a file that is not there, and a file nobody named. */

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

describe("published bins", () => {
  const entries = Object.entries(pkg.bin as Record<string, string>);

  it("names at least the two commands sites run", () => {
    expect(Object.keys(pkg.bin)).toEqual(
      expect.arrayContaining(["sitekit-editor-css", "sitekit-headers"])
    );
  });

  /* Split on \r?\n rather than \n: these files are checked out with Windows
     line endings here and Unix ones in CI, and a shebang assertion that reads
     the \r is a test about the developer's machine. */
  it.each(entries)("%s points at a file node can run", (_name, path) => {
    const source = readFileSync(resolve(root, path), "utf8");
    expect(source.split(/\r?\n/)[0]).toBe("#!/usr/bin/env node");
  });

  it("names every file in bin/, so none ships unreachable", () => {
    const named = new Set(entries.map(([, path]) => path.replace(/^\.\//, "")));
    for (const file of readdirSync(resolve(root, "bin"))) {
      expect(named).toContain(`bin/${file}`);
    }
  });

  it("keeps bin/ in the published files", () => {
    expect(pkg.files).toContain("bin");
  });
});
