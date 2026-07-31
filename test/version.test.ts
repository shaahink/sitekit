/* The version constant cannot be allowed to rot.
   ---------------------------------------------------------------------------
   `src/version.ts` is hand-written, for the reasons its own header gives, and
   a hand-written copy of a number that lives somewhere else is a lie waiting
   for a release to tell it. This is the thing that stops that.

   It is the lesson `fleet-migrate.test.mjs` cost, applied one file over:
   assert against the source of truth itself, never against a second
   hand-written string standing in for it. A test reading `"0.23.0"` from a
   literal here would pass forever while the package said something else. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KIT_VERSION } from "../src/version.js";

describe("KIT_VERSION", () => {
  it("is what package.json says this release is", () => {
    const path = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(path, "utf8")) as { version: string };
    expect(KIT_VERSION).toBe(pkg.version);
  });
});
