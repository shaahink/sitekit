import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
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

  it("names at least the three commands sites run", () => {
    expect(Object.keys(pkg.bin)).toEqual(
      expect.arrayContaining(["sitekit-editor-css", "sitekit-headers", "sitekit-normalize"])
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

/* sitekit-normalize, and the property every site's CI leans on.
   ---------------------------------------------------------------------------
   The gate is `npm run content` followed by `git diff --exit-code -- src/content`,
   which only works because the command is a fixed point: a fleet whose content
   is already normalized must come out of a run with nothing rewritten. If that
   ever stopped holding, six repos would fail CI on every push for a reason
   nobody would look for in a bin file.

   `normalize()` itself is tested in cms-yaml.test.ts against a real fixture.
   What is tested here is the command around it — which files it finds, what it
   leaves alone, and what it says when there is nothing to work on. */
describe("sitekit-normalize", () => {
  const bin = resolve(root, "bin", "normalize.mjs");
  const run = (dir: string, ...args: string[]) =>
    spawnSync(process.execPath, [bin, ...args], { cwd: dir, encoding: "utf8" });

  /* Unquoted keys and a long line: the reflow this command exists to do once.
     The comment matters — content YAML carries comments that explain the model,
     and losing them is the failure that would make the whole approach unusable. */
  const messy =
    "# what this file is\n" +
    'title:    "A room"\n' +
    "blurb: >-\n" +
    "  One long hand-authored line that is well past eighty columns and therefore something the normalizer has an opinion about.\n";

  it("rewrites a file that needs it, keeps the comment, and is then a fixed point", () => {
    const dir = mkdtempSync(join(tmpdir(), "sitekit-normalize-"));
    try {
      const content = join(dir, "src", "content", "rooms");
      mkdirSync(content, { recursive: true });
      writeFileSync(join(content, "one.yaml"), messy);

      const first = run(dir);
      expect(first.status).toBe(0);
      expect(first.stdout).toContain("1 file(s) rewritten");

      const written = readFileSync(join(content, "one.yaml"), "utf8");
      expect(written).toContain("# what this file is");
      expect(written).not.toContain("\r\n");

      /* The gate's property. Nothing rewritten, so `git diff` stays empty. */
      const second = run(dir);
      expect(second.status).toBe(0);
      expect(second.stdout).toContain("content already normalized");
      expect(readFileSync(join(content, "one.yaml"), "utf8")).toBe(written);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds .yml as well as .yaml, and leaves everything else alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "sitekit-normalize-"));
    try {
      const content = join(dir, "src", "content");
      mkdirSync(content, { recursive: true });
      writeFileSync(join(content, "a.yml"), messy);
      /* A sibling the walk must not touch: content directories hold Markdown
         and JSON too, and normalize() would mangle either. */
      writeFileSync(join(content, "b.md"), messy);

      expect(run(dir).stdout).toContain("1 file(s) rewritten");
      expect(readFileSync(join(content, "b.md"), "utf8")).toBe(messy);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("takes a directory, so a site's content need not live in src/content", () => {
    const dir = mkdtempSync(join(tmpdir(), "sitekit-normalize-"));
    try {
      mkdirSync(join(dir, "data"), { recursive: true });
      writeFileSync(join(dir, "data", "one.yaml"), messy);

      const out = run(dir, "data");
      expect(out.status).toBe(0);
      expect(out.stdout).toContain("1 file(s) rewritten");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /* The failure a site actually hits: one content file with broken YAML among
     thirty-two. `normalize()` says what is wrong and cannot know where it was
     read from, and the per-site script this replaces let the throw escape — so
     CI printed a parse error and a stack through dist/cms/yaml.js with no
     filename in it anywhere. */
  it("names the file whose YAML it could not parse", () => {
    const dir = mkdtempSync(join(tmpdir(), "sitekit-normalize-"));
    try {
      const content = join(dir, "src", "content", "rooms");
      mkdirSync(content, { recursive: true });
      writeFileSync(join(content, "fine.yaml"), 'title: "ok"\n');
      writeFileSync(join(content, "broken.yaml"), "meta:  title: one  other: two\n");

      const out = run(dir);
      expect(out.status).toBe(1);
      expect(out.stderr).toContain("broken.yaml");
      expect(out.stderr).toContain("not valid YAML");
      expect(out.stderr).not.toMatch(/^\s+at /m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /* Run from the wrong directory — the likeliest way anyone meets this command
     failing. The per-site script it replaces threw a readdirSync stack; a
     command has to say what to do instead. */
  it("says what is wrong when there is no content directory, without a stack", () => {
    const dir = mkdtempSync(join(tmpdir(), "sitekit-normalize-"));
    try {
      const out = run(dir);
      expect(out.status).toBe(1);
      expect(out.stderr).toContain("no content directory at");
      expect(out.stderr).toContain("Run it from a site root");
      expect(out.stderr).not.toMatch(/^\s+at /m);
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
