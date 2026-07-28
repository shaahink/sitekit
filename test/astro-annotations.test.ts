import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkAnnotations } from "../src/astro/annotations.js";
import { scanAnnotations } from "../src/astro/scan.js";

/* The fixture is a miniature site: one content tree, two built outputs. The
   clean one is what four real sites look like today — 310 annotations that all
   resolve — and the broken one is every way that stops being true. Both are
   read off disk by the integration itself, so what these tests exercise is the
   thing a site's build runs, not a rehearsal of it. */
const SITE = new URL("./fixtures/annotation-site/", import.meta.url);

const homePage = z.object({
  hero: z.object({
    title: z.string(),
    tagline: z.string(),
    visible: z.boolean().default(true)
  }),
  about: z.object({
    body: z.string(),
    portrait: z.object({
      src: z.string(),
      alt: z.string().default(""),
      w: z.number().int().positive(),
      h: z.number().int().positive()
    })
  })
});

const works = z.object({ title: z.string(), body: z.string() });

const collections = {
  homePage: {
    schema: homePage,
    file: "src/content/pages/home.yaml",
    /* The fleet omits every picture's pixel sizes: the layouts depend on them
       and an owner has no business typing them. Which is exactly why an
       annotation pointing at one has to fail — the value is in the file, so
       only the form model knows it is off limits. */
    omit: ["about.portrait.w", "about.portrait.h"]
  },
  works: { schema: works, dir: "src/content/works" }
};

interface Logged {
  info: string[];
  warn: string[];
  error: string[];
}

/** Runs the integration the way Astro does: config first, then build. */
function build(dist: string): { logged: Logged; run: () => void } {
  const logged: Logged = { info: [], warn: [], error: [] };
  const integration = checkAnnotations({ collections });
  integration.hooks["astro:config:done"]({ config: { root: SITE } });
  return {
    logged,
    run: () =>
      integration.hooks["astro:build:done"]({
        dir: new URL(`${dist}/`, SITE),
        logger: {
          info: (message: string) => logged.info.push(message),
          warn: (message: string) => logged.warn.push(message),
          error: (message: string) => logged.error.push(message)
        }
      })
  };
}

/** Everything a failing build says — the listing goes through the logger and
    only the sentence is thrown, so a reader of CI output sees both. Empty when
    the build passed. */
function failure(dist: string): string {
  const { logged, run } = build(dist);
  try {
    run();
    return "";
  } catch (error) {
    return [...logged.error, (error as Error).message].join("\n");
  }
}

describe("scanAnnotations", () => {
  it("reads the scope and every annotation in document order", () => {
    const scan = scanAnnotations(
      `<body data-sk-collection="homePage" data-sk-entry="home">
         <h1 data-sk-edit="hero.title">t</h1>
         <p data-sk-edit="hero.tagline">g</p>
       </body>`
    );
    expect(scan.scopes).toEqual([{ collection: "homePage", entry: "home" }]);
    expect(scan.paths).toEqual(["hero.title", "hero.tagline"]);
  });

  it("is not fooled by a '>' inside another attribute's value", () => {
    /* The whole reason this is a tokenizer rather than a regex. Two of these
       sites are hand-written prose and `title="a > b"` is ordinary content. */
    const scan = scanAnnotations(`<h1 title="Bruce > everyone" data-sk-edit="hero.title">t</h1>`);
    expect(scan.paths).toEqual(["hero.title"]);
  });

  it("ignores script and style bodies", () => {
    /* Astro inlines small scripts, and the inline editor's own bundle contains
       the literal selector. Scanned naively, every page carrying the editor
       reports an annotation nobody wrote. */
    const scan = scanAnnotations(
      `<script>document.querySelectorAll("[data-sk-edit]");</script>
       <style>[data-sk-edit] { outline: 1px solid red }</style>
       <p data-sk-edit="real.one">x</p>`
    );
    expect(scan.paths).toEqual(["real.one"]);
  });

  it("ignores comments", () => {
    const scan = scanAnnotations(`<!-- <p data-sk-edit="ghost">x</p> --><p data-sk-edit="real">y</p>`);
    expect(scan.paths).toEqual(["real"]);
  });

  it("reads single-quoted, unquoted and upper-cased attributes", () => {
    const scan = scanAnnotations(
      `<p DATA-SK-EDIT='a.one'>1</p><p data-sk-edit=a.two class="x">2</p><P Data-Sk-Edit="a.three">3</P>`
    );
    expect(scan.paths).toEqual(["a.one", "a.two", "a.three"]);
  });

  it("keeps every scope and every duplicate, because the faults are in those", () => {
    const scan = scanAnnotations(
      `<body data-sk-collection="a"><section data-sk-collection="b">
         <p data-sk-edit="one">x</p><p data-sk-edit="one">x</p>
       </section></body>`
    );
    expect(scan.scopes.map((scope) => scope.collection)).toEqual(["a", "b"]);
    expect(scan.paths).toEqual(["one", "one"]);
  });

  it("survives a void element, a self-closing tag and a bare '<' in text", () => {
    const scan = scanAnnotations(
      `<meta charset="utf-8" /><br><p>3 < 4</p><img src="a.jpg"><p data-sk-edit="after">y</p>`
    );
    expect(scan.paths).toEqual(["after"]);
  });

  it("stops at the end of an unterminated tag rather than looping", () => {
    expect(scanAnnotations(`<p data-sk-edit="one"`).paths).toEqual(["one"]);
    expect(scanAnnotations(`<!-- never closed`).paths).toEqual([]);
  });
});

describe("checkAnnotations", () => {
  it("passes a site whose annotations all resolve, and says how many", () => {
    const { logged, run } = build("dist-clean");
    expect(run).not.toThrow();
    expect(logged.info).toEqual(["5 annotations on 2 pages all resolve"]);
    /* edit.html has neither a scope nor an annotation, so it is not a page
       this check has an opinion about. */
    expect(logged.warn).toEqual([]);
  });

  it("fails on a path that resolves to nothing in the content", () => {
    expect(failure("dist-broken")).toContain(
      `index.html  data-sk-edit="hero.strapline" resolves to nothing in the content`
    );
  });

  it("fails on a path the form model omits", () => {
    /* The value is in the file, so only the form model knows this one is off
       limits — which is the case a runtime-only check catches last, because
       the element renders and reads perfectly well. */
    expect(failure("dist-broken")).toContain(
      `data-sk-edit="about.portrait.w" has no field in the form model — is it on the collection's omit list?`
    );
  });

  it("fails on the same path twice on one page", () => {
    expect(failure("dist-broken")).toContain(
      `data-sk-edit="hero.title" appears more than once on this page; only the first would be editable`
    );
  });

  it("fails on annotations with no data-sk-collection above them", () => {
    expect(failure("dist-broken")).toContain(
      "orphan.html carries 2 annotations but no data-sk-collection"
    );
  });

  it("fails on a second element carrying data-sk-collection", () => {
    const message = failure("dist-broken");
    expect(message).toContain("double.html has 2 elements carrying data-sk-collection");
    expect(message).toContain(`the editor reads the first ("homePage") and silently ignores "works"`);
  });

  it("fails on a collection the editor does not have, and lists the ones it does", () => {
    const message = failure("dist-broken");
    expect(message).toContain(`unknown.html scopes data-sk-collection="homepage"`);
    expect(message).toContain(`("homePage", "works")`);
  });

  it("fails on an entry whose content file is gone", () => {
    expect(failure("dist-broken")).toContain(
      "works/gone.html scopes \"works\" entry \"gone\", whose content file src/content/works/gone.yaml does not exist"
    );
  });

  it("names the .yml spelling rather than calling the file missing", () => {
    /* listEntries() accepts .yml and filePath() only ever asks for .yaml, so
       such an entry is listed in the panel and 404s when opened. */
    expect(failure("dist-broken")).toContain(
      "the editor reads src/content/works/legacy.yaml, and this site has src/content/works/legacy.yml"
    );
  });

  it("fails when a single-file collection is scoped to the wrong entry", () => {
    expect(failure("dist-broken")).toContain(
      `wrong-entry.html says data-sk-entry="about", but "homePage" is a single file`
    );
  });

  it("warns, but does not fail, on a page that scopes and annotates nothing", () => {
    const { logged, run } = build("dist-broken");
    expect(run).toThrow();
    expect(logged.warn).toContain('scoped-only.html scopes "homePage" but carries no data-sk-edit');
  });

  it("counts them before listing them, and throws a sentence rather than the list", () => {
    const { logged, run } = build("dist-broken");
    expect(run).toThrow(/^\d+ editor annotation problems — each is an element an owner/);
    expect(logged.error).toHaveLength(1);
    expect(logged.error[0]).toMatch(/^\d+ editor annotation problems across \d+ pages:/);
  });
});
