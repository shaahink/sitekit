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

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { KIT_VERSION } from "../version.js";
import { editorManifest, type ManifestIcon } from "./manifest.js";
import { settleStylePolicy } from "./style-policy.js";
import { serviceWorkerSource } from "./worker.js";

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
  /** Installing the editor to a home screen. Present by default, because the
      whole point of 0.23.0 is that an owner should not have to be given it
      site by site; pass `false` to leave a site out. */
  app?: EditorAppOptions | false;
}

/** What an installed editor is called and how it looks before it has painted.
    Every field is optional and every default is derived from something the
    site already declares, so a site that says nothing still gets an installable
    editor — which is the difference between a feature the fleet has and a
    feature six repos would have had to opt into one at a time. */
export interface EditorAppOptions {
  /** The full name under the icon. Defaults to the route's `title`. */
  name?: string;
  /** The truncated one. Home screens cut hard at about twelve characters. */
  shortName?: string;
  themeColor?: string;
  backgroundColor?: string;
  /** Overrides the site's own icon. Rarely wanted: the default is whatever
      `publicDir` already ships, which is the icon the owner recognises. */
  icons?: ManifestIcon[];
  description?: string;
}

/* Deliberately not `/manifest.webmanifest` and not `/sw.js`. The studio's own
   repo already serves both of those names for the fleet console, and it is
   also a site in this fleet — so the unprefixed names would have collided on
   exactly one of the seven repos, which is the sort of thing that is found
   late and in production. Prefixed, they cannot collide with anything a site
   has, and they say who put them there. */
const MANIFEST_PATH = "/sk-editor.webmanifest";
const WORKER_PATH = "/sk-editor-sw.js";

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
  /** Where the manifest answers, or null on a site that opted out. The page
      links it only when it exists, so opting out removes the link rather than
      leaving one that 404s. */
  manifestPath: string | null;
  /** The worker to register, or null. Passed through to the page so the
      client never has to know this file's name — a constant duplicated into a
      bundle is a constant that can disagree with the file it names. */
  workerPath: string | null;
  /** Painted by the browser around the app before any CSS has loaded. */
  themeColor: string;
  /** This release, shown in the account sheet. See ../version.ts for why it is
      a constant with a test rather than a build-time read. */
  version: string;
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
  const app = options.app === false ? null : (options.app ?? {});
  const editorPath = options.pattern ?? "/edit";

  /* Filled in by config:setup and read by build:done. Which icon a site ships
     cannot be known until Astro has resolved `publicDir`, and the manifest
     that names it is not written until the build is over, so the one value has
     to survive between two hooks. A field on the closure rather than a second
     call to `siteIcon`, because reading the disk twice and getting two answers
     is a bug that would only ever appear on a machine where it mattered. */
  let icon: EditorRouteConfig["icon"] = null;

  return {
    name: "@shaahink/sitekit:editor-route",
    hooks: {
      "astro:config:setup": ({ config, injectRoute, updateConfig }: SetupHook) => {
        icon = siteIcon(config.publicDir);
        const resolved: EditorRouteConfig = {
          title: options.title,
          needsStyleAttr: !declaresStyleAttr(config),
          icon,
          manifestPath: app ? MANIFEST_PATH : null,
          workerPath: app ? WORKER_PATH : null,
          themeColor: app?.themeColor ?? "#ffffff",
          version: KIT_VERSION
        };

        /* The page is a published .astro file; the site's own build compiles
           it, which is why it ships as source rather than through tsc. */
        injectRoute({
          pattern: editorPath,
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
      /* Two things that cannot be decided while the config is being read.

         The style policy depends on hashes the build has not computed yet —
         see style-policy.ts, measured fleet-wide before writing it, and five
         of the six sites needed it.

         The manifest and the worker are written here rather than injected as
         routes because they are static text that depends only on the config,
         and an injected route would have meant two more published entry
         points, two more export map lines, and an endpoint file compiled by
         each site's build to return a constant. Writing them into the built
         output is the whole of what a route would have achieved. */
      "astro:build:done": ({ dir, logger }: BuildDoneHook) => {
        settleStylePolicy(dir, logger);
        if (app) emitApp(dir, logger, options, app, editorPath, icon);
      }
    }
  };
}

/** The site's own icon, described the way a manifest wants it.

    An SVG is declared `sizes: "any"`, which is the spelling that satisfies
    Chrome's installability check without anybody generating PNGs — and every
    site in this fleet ships an SVG, which is why the default costs nothing. A
    raster icon is a different matter: its real dimensions are not knowable
    without decoding it, and a manifest that lies about a size is worse than
    one that omits it, so it is declared `any` too and left to the browser to
    reject if it is too small. */
function manifestIcons(icon: EditorRouteConfig["icon"]): ManifestIcon[] {
  if (!icon) return [];
  return [{ src: icon.href, sizes: "any", type: icon.type, purpose: "any" }];
}

function emitApp(
  dir: URL,
  logger: BuildDoneHook["logger"],
  options: EditorRouteOptions,
  app: EditorAppOptions,
  editorPath: string,
  icon: EditorRouteConfig["icon"]
): void {
  const root = fileURLToPath(dir);
  const icons = app.icons ?? manifestIcons(icon);

  /* Said out loud rather than left to be discovered. A manifest with no icon
     is a manifest no browser will ever offer to install, so the feature is
     simply absent — and an absent feature that nothing complains about is the
     exact failure shape this repo keeps re-learning. The build still succeeds:
     an editor that cannot be installed is a working editor. */
  if (icons.length === 0) {
    logger.warn(
      `sitekit: ${MANIFEST_PATH} has no icons, because this site ships none of ` +
        `favicon.svg, icon.svg, favicon.png or favicon.ico in its publicDir. ` +
        `The editor will work and will never be offered as an installable app. ` +
        `Add one of those files, or pass editorRoute({ app: { icons: [...] } }).`
    );
  }

  const manifest = editorManifest({
    name: app.name ?? options.title,
    ...(app.shortName === undefined ? {} : { shortName: app.shortName }),
    editorPath,
    ...(app.themeColor === undefined ? {} : { themeColor: app.themeColor }),
    ...(app.backgroundColor === undefined ? {} : { backgroundColor: app.backgroundColor }),
    icons,
    ...(app.description === undefined ? {} : { description: app.description })
  });

  writeFileSync(join(root, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeFileSync(
    join(root, WORKER_PATH),
    serviceWorkerSource({
      editorPath,
      manifestPath: MANIFEST_PATH,
      /* The cache name carries the release, so an owner's device drops the
         previous shell on the first load after a bump instead of serving it
         until they clear their browser. */
      version: KIT_VERSION
    }),
    "utf8"
  );
}
