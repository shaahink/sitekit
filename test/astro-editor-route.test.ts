import { describe, it, expect } from "vitest";
import { editorRoute } from "../src/astro/index.js";

/* Every site's real `security.csp.styleDirective.resources`, read off its
   astro.config.mjs on 2026-07-28, paired with whether that site's hand-written
   edit.astro emitted `style-src-attr 'unsafe-inline'` for itself.

   This is the only decision the integration makes from a site's config, and
   getting it wrong is quiet: too few and Google's sign-in loses the style
   attributes it sets on its own elements; too many and the built policy reads
   `style-src-attr 'unsafe-inline' 'unsafe-inline'`, which browsers accept but
   which costs the byte-for-byte claim this migration rests on. So the fleet's
   ground truth is the fixture. */
const FLEET = [
  { site: "bez", resources: ["'self'", { resource: "'unsafe-inline'", kind: "attribute" }], emitted: false },
  { site: "shade", resources: ["'self'"], emitted: true },
  { site: "elfine", resources: ["'self'"], emitted: true },
  { site: "nimagiti", resources: ["'self'", { resource: "'unsafe-inline'", kind: "attribute" }], emitted: false },
  { site: "studio", resources: ["'self'"], emitted: true },
  { site: "template", resources: ["'self'"], emitted: true }
] as const;

/** Runs the integration's setup hook and returns what it injected and loaded. */
function setup(config: unknown, options = { title: "Edit — Test" }) {
  const routes: Array<{ pattern: string; entrypoint: string }> = [];
  let plugin: any;

  const integration = editorRoute(options);
  integration.hooks["astro:config:setup"]({
    config: config as any,
    injectRoute: (route) => routes.push(route),
    updateConfig: (update: any) => (plugin = update.vite.plugins[0])
  });

  const id = plugin.resolveId("virtual:sitekit-editor-route");
  const loaded = JSON.parse(plugin.load(id).replace("export default ", "").replace(/;$/, ""));
  return { routes, loaded };
}

const cspWith = (resources: unknown) => ({
  security: { csp: { directives: ["default-src 'self'"], styleDirective: { resources } } }
});

describe("editorRoute", () => {
  it("reproduces every site's style-src-attr decision", () => {
    for (const { site, resources, emitted } of FLEET) {
      const { loaded } = setup(cspWith(resources));
      expect(loaded.needsStyleAttr, site).toBe(emitted);
    }
  });

  it("asks for the attribute source when a site declares no style directive", () => {
    expect(setup({ security: { csp: { directives: [] } } }).loaded.needsStyleAttr).toBe(true);
    expect(setup({}).loaded.needsStyleAttr).toBe(true);
  });

  it("does not mistake a plain 'unsafe-inline' for the attribute one", () => {
    /* A bare string lands in style-src, and style-src-attr does not inherit
       from it — so the route still has to ask. */
    expect(setup(cspWith(["'self'", "'unsafe-inline'"])).loaded.needsStyleAttr).toBe(true);
  });

  it("injects one prerendered route, defaulting to /edit", () => {
    const { routes } = setup(cspWith(["'self'"]));
    expect(routes).toEqual([
      { pattern: "/edit", entrypoint: "@shaahink/sitekit/astro/edit.astro", prerender: true }
    ]);
  });

  it("lets a site choose the path, for a fleet that will not always agree", () => {
    const { routes } = setup(cspWith(["'self'"]), { title: "t", pattern: "/admin" } as any);
    expect(routes[0].pattern).toBe("/admin");
  });

  it("passes the title through, because it is the only part that is the site's", () => {
    expect(setup(cspWith(["'self'"]), { title: "Edit — Bruce Nemeth" }).loaded.title).toBe(
      "Edit — Bruce Nemeth"
    );
  });
});

/* Bug #19. The page hardcoded `/favicon.svg` from 0.11.0, which is right on the
   sites that happen to ship that filename and a 404 in the owner's own console on
   the ones that don't. Real directories rather than a mocked `existsSync`,
   because the thing being tested is what the filesystem says. */
describe("the icon the editor page links", () => {
  /* A file URL, which is what Astro's resolved config carries. Built with `new
     URL` rather than from a path, because `import.meta.url` is already one and
     round-tripping it through a string loses the drive letter on Windows. */
  const publicDir = (name: string) => new URL(`fixtures/icons/${name}/`, import.meta.url);

  it("names the file a site actually ships", () => {
    expect(setup({ publicDir: publicDir("icon-svg") }).loaded.icon).toEqual({
      href: "/icon.svg",
      type: "image/svg+xml"
    });
  });

  it("prefers favicon.svg where a site ships both, so nothing about bez moves", () => {
    expect(setup({ publicDir: publicDir("favicon-svg") }).loaded.icon).toEqual({
      href: "/favicon.svg",
      type: "image/svg+xml"
    });
  });

  it("links nothing at all rather than guessing", () => {
    /* And that is deliberately not the same as dropping the link everywhere: a
       document with no icon link makes the browser ask for /favicon.ico, so
       dropping it unconditionally would have turned one site's 404 into six. */
    expect(setup({ publicDir: publicDir("none") }).loaded.icon).toBeNull();
    expect(setup({}).loaded.icon).toBeNull();
  });
});
