/* The editor's route, injected rather than copied.
   ---------------------------------------------------------------------------
   Until 0.11.0 every site owned a `src/pages/edit.astro` — six copies of one
   admin page, 109 to 129 lines each, already 52 to 68 lines apart. The file's
   own header said it should never change again and that if improving the
   editor ever meant editing it, the boundary was in the wrong place. On
   2026-07-28 it changed in four client repos in one afternoon, because Google
   Identity Services turned out to load a stylesheet into the document and
   every site's CSP had to learn that separately. So the boundary moves here.

   A site now says this once, in astro.config.mjs:

     import { editorRoute } from "@shaahink/sitekit/astro";
     integrations: [editorRoute({ title: "Edit — Bruce Nemeth" })]

   and owns no editor files at all. The route pattern is `/edit`; Astro applies
   the site's own `build.format`, so a site on "file" still serves /edit.html
   and a site on "directory" still serves /edit. Both URLs are unchanged from
   the hand-written pages they replace.

   Why the CSP lives here rather than in each site. The edit route needs four
   things the public pages don't — Google's script, its iframe, its stylesheet
   and the avatar on lh3 — and nothing else about it varies.

   Every site's page carried a comment saying it restated its own frame-src and
   img-src "rather than assuming a merge, so the result is correct whether
   Astro appends to them or replaces them". **Astro appends.** Read off
   nimagiti's built page on 2026-07-28: its edit.astro asks for exactly
   `frame-src https://accounts.google.com` and the page ships
   `frame-src https://w.soundcloud.com https://www.youtube-nocookie.com
   https://accounts.google.com` — the union with astro.config, which the page
   never mentions. So the restatements were harmless and unnecessary, and the
   route only ever has to name what the editor itself loads. The site's own
   sources arrive on their own.

   That is also why replacing six pages with this one is output-identical
   rather than merely equivalent: whatever a site permits publicly still
   reaches this route through its own config, exactly as before.

   The one thing that genuinely depends on the site is `style-src-attr`.
   Google sets style attributes on the elements it injects, hashes never apply
   to attributes, and a directive stated twice is ignored rather than merged —
   so it must be emitted exactly when the site does not already declare it.
   Reading that off the resolved config is the whole reason this is an
   integration and not a page the sites import. */

/* The other thing a site's astro.config.mjs asks the kit for, re-exported so
   that stays one import rather than two — the two integrations are configured
   side by side in the same array, and a site that has annotations almost
   always has the route as well. They remain separate integrations because the
   converse is not true: `sk-studio` has annotations and still owns its editor
   page (SCALE.md §9), and the template scopes a page before annotating it. */
export { checkAnnotations } from "./annotations.js";
export type { AnnotationCheckOptions, AnnotationProblem } from "./annotations.js";

/* And the third, added in 0.20.0. Separate from the annotation checker for the
   same reason that one is separate from the route — they answer different
   questions and a site should be able to have either without the other — and
   beside it in the same import for the same reason: they are configured in the
   same array from the same `editable` map, and two imports for one line of
   wiring is one more thing a new site can half-copy. */
export {
  checkPlaceholders,
  checkEntry,
  allowsPath,
  entriesOnDisk,
  findPlaceholders
} from "./placeholders.js";
export type { PlaceholderCheckOptions, PlaceholderProblem } from "./placeholders.js";

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { settleStylePolicy } from "./style-policy.js";

/* Astro is a peer, not a dependency: the kit is installed by six sites that
   all have their own copy, and pulling a second one in to typecheck four
   property reads would be the tail wagging the dog. The surface used here is
   small and stable, so it is described structurally. The check that matters is
   that a real site builds — `npm run proof` does exactly that against
   site-template before any release. */

/** A source entry in `security.csp.styleDirective.resources`. */
type StyleResource = string | { resource: string; kind?: "element" | "attribute" };

/** Only the properties this integration reads. */
interface ResolvedConfig {
  security?: {
    csp?:
      | boolean
      | {
          directives?: string[];
          styleDirective?: { resources?: StyleResource[] };
        };
  };
  /** Where the site keeps the files it serves verbatim — read to find out which
      icon this site actually ships. See `siteIcon`. */
  publicDir?: URL;
}

interface SetupHook {
  config: ResolvedConfig;
  injectRoute: (route: { pattern: string; entrypoint: string; prerender?: boolean }) => void;
  updateConfig: (config: Record<string, unknown>) => void;
}

interface BuildDoneHook {
  dir: URL;
  logger: { info: (message: string) => void; warn: (message: string) => void };
}

export interface EditorRouteOptions {
  /** The page's <title>. The one thing about this route that is the site's —
      an owner should see whose site they are editing. */
  title: string;
  /** Where the route is served. Defaults to "/edit", which the site's
      build.format turns into /edit.html or /edit as it already does. */
  pattern?: string;
}

/** What the injected page imports. Kept in one place so the page and the
    virtual module cannot disagree about the shape. */
export interface EditorRouteConfig {
  title: string;
  /** True when the site does not already permit inline style attributes, and
      the route must therefore ask for them itself. */
  needsStyleAttr: boolean;
  /** The icon this site actually ships, or null where it ships none of the ones
      worth guessing at. See `siteIcon`. */
  icon: { href: string; type: string } | null;
}

/* Which icon a site ships, read off the site rather than assumed.
   ---------------------------------------------------------------------------
   Bug #19, and it is the smallest possible example of why an injected route has
   to ask. Since 0.11.0 this page has said
   `<link rel="icon" href="/favicon.svg">` — the one line by which its output
   differed from the hand-written pages it replaced — and the href was never
   checked against what any site actually has. bez ships `favicon.svg` and is
   clean; nimagiti ships `icon.svg`, so every load of his editor logged a 404 in
   his own console. A per-site coin flip, harmless to function, and visible to
   anyone who opens devtools on their own site.

   Three ways out were on the table. `editorRoute({ icon })` would have made the
   per-site wiring differ between sites, and §2.9 stakes the boundary on that
   wiring being byte-identical everywhere. Dropping the link is worse than the
   bug: a document with no icon link makes the browser ask for `/favicon.ico`,
   which none of the six sites ships, so a 404 on one site would have become a
   404 on all six. So the route reads `publicDir` — which it already has, because
   it already reads the resolved config for the style policy — and names what is
   there. Zero configuration, correct on every site, and a site that ships no
   icon at all gets no link and no request.

   The order is by preference, not by likelihood: an SVG scales, and `.ico` is
   only here because a site made before the fleet existed might have one. */
const ICONS: Array<{ file: string; type: string }> = [
  { file: "favicon.svg", type: "image/svg+xml" },
  { file: "icon.svg", type: "image/svg+xml" },
  { file: "favicon.png", type: "image/png" },
  { file: "favicon.ico", type: "image/x-icon" }
];

function siteIcon(publicDir: URL | undefined): EditorRouteConfig["icon"] {
  if (!publicDir) return null;
  const root = fileURLToPath(publicDir);
  for (const { file, type } of ICONS) {
    if (existsSync(join(root, file))) return { href: `/${file}`, type };
  }
  return null;
}

const VIRTUAL_ID = "virtual:sitekit-editor-route";

/** True when the site's own CSP already carries `style-src-attr
    'unsafe-inline'`. A bare "'unsafe-inline'" in resources does not count: it
    lands in style-src, and style-src-attr does not inherit from it. */
function declaresStyleAttr(config: ResolvedConfig): boolean {
  const csp = config.security?.csp;
  if (!csp || csp === true) return false;
  return (csp.styleDirective?.resources ?? []).some(
    (entry) =>
      typeof entry === "object" && entry.kind === "attribute" && entry.resource === "'unsafe-inline'"
  );
}

export function editorRoute(options: EditorRouteOptions) {
  return {
    name: "@shaahink/sitekit:editor-route",
    hooks: {
      "astro:config:setup": ({ config, injectRoute, updateConfig }: SetupHook) => {
        const resolved: EditorRouteConfig = {
          title: options.title,
          needsStyleAttr: !declaresStyleAttr(config),
          icon: siteIcon(config.publicDir)
        };

        /* The page is a published .astro file; the site's own build compiles
           it, which is why it ships as source rather than through tsc. */
        injectRoute({
          pattern: options.pattern ?? "/edit",
          entrypoint: "@shaahink/sitekit/astro/edit.astro",
          prerender: true
        });

        updateConfig({
          vite: {
            plugins: [
              {
                name: "sitekit:editor-route-config",
                resolveId: (id: string) => (id === VIRTUAL_ID ? `\0${VIRTUAL_ID}` : undefined),
                load: (id: string) =>
                  id === `\0${VIRTUAL_ID}`
                    ? `export default ${JSON.stringify(resolved)};`
                    : undefined
              }
            ]
          }
        });
      },

      /* The one thing about this page's policy that cannot be decided while
         the config is being read, because it depends on hashes the build has
         not computed yet. See style-policy.ts — measured fleet-wide before
         writing it, and five of the six sites needed it. */
      "astro:build:done": ({ dir, logger }: BuildDoneHook) => {
        settleStylePolicy(dir, logger);
      }
    }
  };
}
