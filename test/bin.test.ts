import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

/* The one behaviour of the command that a unit test can reach, because it is
   about the command rather than about the emitter: what a site sees when its
   config cannot be emitted. The emitter's refusal is tested in
   headers.test.ts; this is the exit code, the sentence, and the promise that
   nothing was written.

   It runs the real bin, which imports the built dist — deliberately, since
   that is what a site runs. `npm run build && npm test` is the loop here and
   prepublishOnly is the same two commands in that order. */
describe("sitekit-headers on a config it must refuse", () => {
  it("exits 1, names the rule, and leaves the site's files alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "sitekit-headers-"));
    try {
      writeFileSync(
        join(dir, "headers.config.mjs"),
        'export default {\n' +
          '  headers: [{ path: "/*", headers: { "X-Content-Type-Options": "nosniff" } }],\n' +
          '  redirects: [{ from: "/old/*", to: "/new/:splat" }]\n' +
          "};\n"
      );

      const run = spawnSync(process.execPath, [resolve(root, "bin", "headers.mjs")], {
        cwd: dir,
        encoding: "utf8"
      });

      expect(run.status).toBe(1);
      expect(run.stderr).toContain("/old/* → /new/:splat");
      expect(run.stderr).toContain("headers.config.mjs");
      /* Loud, not noisy: an unhandled throw would print a stack through
         dist/headers/index.js above the only line that says what to change. */
      expect(run.stderr).not.toMatch(/^\s+at /m);
      /* The refusal happens before the first write, so a site whose config is
         wrong still has the vercel.json it committed. */
      expect(existsSync(join(dir, "vercel.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* Where the Cloudflare artefacts land, which is not a detail: _headers and
   _redirects are read from the build output and functions/ is read from the
   repository, so two of the three follow --cloudflare's directory and one
   cannot. Getting that wrong produces a middleware Pages never runs, and a
   site whose API responses are bare exactly as finding 1 measured. */
describe("sitekit-headers --cloudflare", () => {
  it("writes _headers beside the build output and the middleware at the root", () => {
    const dir = mkdtempSync(join(tmpdir(), "sitekit-cloudflare-"));
    try {
      writeFileSync(
        join(dir, "headers.config.mjs"),
        'export default {\n' +
          '  headers: [\n' +
          '    { path: "/*", headers: { "X-Frame-Options": "SAMEORIGIN" } },\n' +
          '    { path: "/api/*", headers: { "Cache-Control": "no-store" } }\n' +
          '  ],\n' +
          '  redirects: [{ from: "/about.html", to: "/", status: 301 }]\n' +
          "};\n"
      );

      const run = spawnSync(process.execPath, [resolve(root, "bin", "headers.mjs"), "--cloudflare"], {
        cwd: dir,
        encoding: "utf8"
      });

      expect(run.status).toBe(0);
      expect(existsSync(join(dir, "vercel.json"))).toBe(true);
      expect(existsSync(join(dir, "public", "_headers"))).toBe(true);
      expect(existsSync(join(dir, "public", "_redirects"))).toBe(true);
      /* Not public/functions/, and not dist/functions/ either. */
      expect(existsSync(join(dir, "public", "functions", "_middleware.js"))).toBe(false);
      const middleware = readFileSync(join(dir, "functions", "_middleware.js"), "utf8");
      expect(middleware).toContain("export async function onRequest(context)");
      expect(middleware).toContain('"Cache-Control": "no-store"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
