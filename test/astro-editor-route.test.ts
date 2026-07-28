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
