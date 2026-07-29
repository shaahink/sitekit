# @shaahink/sitekit

Shared logic for the sk site fleet. Logic only — no layout, no design system,
no house style. Each site keeps its own face; this package holds the machinery
they have in common.

Extracted from `elfine-site`'s review-mode feedback system, which remains the
reference for how a site consumes it.

## Entry points

| Import | What it is |
| --- | --- |
| `@shaahink/sitekit/feedback` | The feedback intake handler factory — validates, uploads screenshots to an orphan branch, files GitHub issues |
| `@shaahink/sitekit/shot` | The screenshot proxy handler factory — serves stored screenshots so GitHub can render them inside private repos |
| `@shaahink/sitekit/widget` | The review-mode widget's mechanics: element refinement, CSS paths, section/context extraction, image downscaling, the POST envelope |
| `@shaahink/sitekit/widget/chrome` | The widget a reviewer sees: `mountReviewWidget()` builds the pill, the picker, the composer, the pins. English, French and Farsi included; a site keeps only `feedback-chrome.css` — see below |
| `@shaahink/sitekit/credits` | The `sk` footer credit: anchor plus schema.org JSON-LD |
| `@shaahink/sitekit/headers` | The dual header emitter: one config, emitted as `vercel.json` and Cloudflare `_headers`/`_redirects` |
| `@shaahink/sitekit/seo` | Site URLs, canonicals and sitemaps from one source |
| `@shaahink/sitekit/analytics` | The Umami tag |
| `@shaahink/sitekit/stats` | Reading that instance back, server side: a single-flight cached login, team-scoped enumeration for a fleet, and one site's totals, top pages and share link for its owner |
| `@shaahink/sitekit/cms` | The owner's editor, server side: Google ID token verification, a signed session cookie, a form model generated from a collection's Zod schema, a comment-preserving YAML writer that commits through the GitHub App, and the owner's home — their traffic, their recent changes, whether the last one is live |
| `@shaahink/sitekit/visibility` | Reading a section's `visible` flag the one safe way — a missing flag means *shown* |
| `@shaahink/sitekit/editor` | The owner's editor, browser side: `mountEditor(element)` builds the whole panel from the form model. Chrome included — see below |
| `@shaahink/sitekit/editor/inline` | Editing the words on the page they are on: `startInlineEditor()`, driven by the `data-sk-edit` annotations |
| `@shaahink/sitekit/editor/inline-gate` | The one-line entry a public page loads to decide whether inline editing should start at all |
| `@shaahink/sitekit/editor/editor.css`, `.../inline.css` | Those two surfaces' stylesheets, for a site to copy into `public/` |
| `@shaahink/sitekit/astro` | The two build-time integrations: `editorRoute()` injects the editor's page, `checkAnnotations()` fails the build when an annotation stops resolving — see below |

Entry points are separate on purpose: a site importing handlers never pulls in
widget code, and the handler entries typecheck against WebWorker globals only —
no DOM, no Node built-ins.

### Where the chrome/palette line actually falls

This section used to be called "why `./editor` ships chrome and `./widget`
doesn't", and the answer it gave was that the widget appears on pages a visitor
sees, so each site owns its DOM, strings and palette. What that bought was six
copies of one 626-line file at three versions, two of them forked to translate
a table of twenty-six strings — so a widget change was six hand edits and two
by-eye re-merges, and a bilingual new site hand-translated the table again.
0.16.0 ended it. **Both surfaces now ship their chrome; what a site owns is the
palette.**

The line is not "public versus admin" after all. It is *who is looking*. A
reviewer is looking at the client's own page and the widget sits on top of it,
so `feedback-chrome.css` stays per-site and the class names it styles are a
contract (`WIDGET_CLASSES`, enforced against `chrome.ts` by a test — renaming
one would break six stylesheets *silently*, because an unstyled widget still
works). Nothing else about the widget was ever site-specific: the DOM was
identical in all six copies and the strings were a table.

The editor is one owner's admin panel on one route, and four hand-maintained
copies of it is exactly what this package exists to prevent. CLAUDE.md's "no
design system in the kit" rule was scoped on 2026-07-28 to say so: it governs
public pages. Nobody's face is their admin panel.

```js
// src/scripts/review-gate.js — the only feedback code a public visitor runs
if (localStorage.getItem("review-mode-key")) {
  Promise.all([
    import("@shaahink/sitekit/widget/chrome"),
    import("./feedback-chrome.css")
  ]).then(([widget]) => widget.mountReviewWidget());
}
```

Both imports are dynamic so neither lands in the bundle every public visitor
downloads, and `mountReviewWidget` is *called* rather than the module
bare-imported, because this package is `sideEffects: false` and a bare import of
a side-effecting module is tree-shaken away to nothing. Measured on
site-template: the public bundle grew 32 bytes and carries no widget class; the
reviewer-only chunk grew 2.9 kB, which is French and Farsi arriving on every
site in the fleet.

A site picks its language by declaring one — the table follows `<html lang>`,
by primary subtag, falling back to English rather than to blanks — and overrides
any word with `mountReviewWidget({ strings: { send: "Enviar" } })`.

A site therefore gets no copy. It tunes the look with the `--sk-editor-*`
custom properties — `bg`, `raise`, `ink`, `line`, `accent`, `font` are enough,
because everything derived from them is a translucent overlay — and the words
with `mountEditor(el, { strings })`. A site's whole editor surface is an
`edit.astro` that mounts the panel and sets its own CSP, two `api/` edges that
read environment variables, and a copied stylesheet. None of those change when
the editor improves; that is the test the boundary has to keep passing.

```js
// src/pages/edit.astro
import { mountEditor } from "@shaahink/sitekit/editor";
const root = document.querySelector("[data-sk-editor]");
if (root) mountEditor(root);
```

The stylesheet is **copied into `public/`, not imported**: Astro folds every
processed stylesheet's hash into *every* page's CSP, so importing it would
change the public pages' policy for no reason. The kit ships the copier too —

```
sitekit-editor-css [destination]   # default public/editor-panel.css
```

— so a site's `package.json` reads `"editor": "sitekit-editor-css"` and CI runs
it and diffs. A per-site copy script would have meant editing four repos the
day the asset moved inside `dist`, which is exactly the boundary this lift
exists to get right.

### The three commands a site runs

```
sitekit-headers [--cloudflare [dir]]   # vercel.json, and Cloudflare's three
sitekit-normalize [directory]          # default src/content
sitekit-editor-css [destination]       # default public/editor-panel.css
```

A site's `package.json` names them `headers`, `content` and `editor`, and its
CI runs each and diffs — regenerate, then `git diff --exit-code`. All three
replaced per-site scripts, and the pattern is the same each time: the *emitting*
is the kit's, the *input* stays the site's. `headers.config.mjs` is a site's own
because what it sends is content; the content files are obviously a site's own;
the editor stylesheet has no site input at all, which is why that one is a copy.

`sitekit-normalize` arrived at 0.16.0, replacing six copies of
`scripts/normalize-content.mjs` that were still byte-identical — the cheap
moment to move something rather than the late one, `emit-headers` having reached
four variants by hash before it went. One thing did have to change: the per-site
script resolved `../src/content` from its own location and then undid Node's URL
pathname on Windows by hand, because a drive letter comes back behind a leading
slash. A command runs from the site root, so the path is `resolve(cwd, …)` and
the workaround left with the copies.

### What a site's `astro.config.mjs` says

```js
import { checkAnnotations, editorRoute } from "@shaahink/sitekit/astro";
import { editable } from "./src/content/schema.js";

integrations: [
  editorRoute({ title: "Edit — Bruce Nemeth" }),
  checkAnnotations({ collections: editable })
]
```

`editorRoute` injects the editor's page, so no site owns one. The URL does not
move: an injected route follows the site's own `build.format`, so a site on
`"file"` still serves `/edit.html`.

It also touches that one page's CSP after the build, and only that page: Astro
writes the build's style hashes into `style-src-elem`, and a hash in a directive
makes `'unsafe-inline'` **ignored** — which is the source Google's sign-in script
needs for the stylesheet it injects. Those hashes belong to other pages (the
editor page has no inline style of its own), so they are dropped from that one
directive and the build log says so. Measured on all six sites before it was
written: five of them were degraded, silently. If the page ever does carry an
inline style, nothing is rewritten and the build warns instead.

`checkAnnotations` reads the built pages back in `astro:build:done` and fails
the build on a `data-sk-edit` that would not save — a path resolving to nothing
in the content, a path with no field in the form model, the same path twice on
one page, annotations with no `data-sk-collection` above them. It reaches both
verdicts the same way the page does at runtime, so the build and the editor
cannot disagree about what is broken. What it deliberately does *not* fail on
is everything the runtime sends to the panel instead: a value inside
`aria-hidden`, an element wrapping the design's own spans, text a template
transforms. Those are correct annotations that simply cannot be edited in
place.

It takes the same `editable` map `api/content.ts` hands `createContentHandler`,
which is why that map has always been a Zod-only module with nothing
Astro-shaped in it. Nothing new is declared, so nothing can drift.

## The portability contract

Handlers are Web-standard: `Request`/`Response`, `fetch`, Web Crypto. The
environment is always an argument — the kit never reads `process.env`. A host's
wrapper reads its own environment at the edge and passes values in:

```js
// api/feedback.js on a Vercel site
import { createFeedbackHandler } from "@shaahink/sitekit/feedback";

const handler = createFeedbackHandler({
  env: () => ({
    token: process.env.FEEDBACK_GITHUB_TOKEN,
    repo: process.env.FEEDBACK_GITHUB_REPO,
    reviewKey: process.env.FEEDBACK_REVIEW_KEY,
    branch: process.env.FEEDBACK_ASSETS_BRANCH,
    siteUrl: process.env.FEEDBACK_SITE_URL,
    allowedOrigin: process.env.FEEDBACK_ALLOWED_ORIGIN
  }),
  locales: [
    { prefix: "fr", name: "French", label: "fr" },
    { prefix: "en", name: "English" }
  ],
  timeZone: "Europe/Brussels"
});

export const GET = handler.GET;
export const POST = handler.POST;
```

Everything a site used to hardcode — timezone, locale names and labels, size
caps, rate limits — is an option with a sensible default.

**Sites pin exact versions.** No `^`.

## Dependencies

Two, and both were argued for rather than reached for.

`yaml` is the kit's only runtime dependency, added for `./cms`. Rewriting
hand-authored content without destroying its diff needs a real parser that
keeps comments and scalar styles — that is not something to hand-roll. It is
pure JavaScript with no Node built-ins, so the portability contract above holds
and the Cloudflare adapter stays a one-line swap.

`zod` is an **optional peer**: `./cms` calls `z.toJSONSchema()` to generate the
editor's form model, and every site already has Zod because Astro's content
collections are built on it. Optional because a site using only `./feedback` or
`./headers` should not be made to install it.

Notably *not* a dependency: a JWT library. PLAN §3.9 named `jose`, but the kit
already signs RS256 with Web Crypto in `feedback/app-auth.ts`, and verifying
Google's ID tokens is the mirror image of that — a few dozen lines against
machinery that already exists and is already tested.

## Development

```
npm install
npm run build   # tsc, four configs: server (WebWorker) + widget (DOM, ES2017)
                # + editor (DOM, ES2020) + astro (Node), then the stylesheets
                # and the .astro route are copied
npm test        # vitest
npm run proof   # build ../site-template against this working copy
```

Four configs because the four halves have different floors. Handlers must not
reach for `document` or a Node built-in, so they typecheck against WebWorker
globals only. The widget ships on public pages and stays at ES2017 to reach as
many visitors as the sites do. The editor is one route for one owner, so ES2020
is honest — and it needs the lib as well as the syntax. `src/astro` is the only
place Node types are admitted, because reading a site's built pages back is
what the annotation checker does.

**`npm run proof` is the one that catches integration bugs.** Both exports in
`./astro` only do anything inside a real Astro build; a unit test calls their
hooks directly, which proves what they do with the arguments they are given and
nothing about whether Astro gives them those arguments. Every fact the kit has
been wrong about there — that `insertDirective` merges rather than replaces,
that an injected route inherits `build.format` — came from reading a real
build. The script overlays this checkout's `dist` **and `package.json`** onto
site-template's installed copy, builds, and puts both back. It is not part of
`prepublishOnly`, because publishing happens from CI where there is no sibling
checkout.

The `package.json` half was added at 0.16.0 and is the same lesson one layer
out: overlaying only `dist` meant the proof could not see a *new* entry point at
all, because the installed release's `exports` map decides what a site can
resolve. `./widget/chrome` was on disk and unreachable, and the build failed on
an import that was correct. A proof that cannot prove a new subpath is a proof
of the last release.

`dist` is emptied before every build. `files: ["dist"]` publishes whatever is in
there, and `tsc` only ever adds, so a moved file used to ship forever.

Behaviours that look like oversights are deliberate and pinned by tests: the
honeypot succeeds quietly, a 422 on issue creation retries without labels — kept
since 0.16.0 as insurance rather than a guard, because measurement says GitHub
creates the label as it files the issue and the failure that *does* happen is a
silently dropped label, which is now read back and reported — a failed
screenshot upload never loses the comment, and the rate limiter sweeps its whole
map above 500 addresses.

`?preview=<field path>` on the content edge, added at 0.16.0, answers with the
bytes of the photograph one image field points at. It exists because a stored
`src` is only a URL on a site whose pictures live in `public/`: where
`astro:assets` owns them the content names a path into the repository that
nothing serves, so the picker drew a broken-image hairline instead of the
photograph an owner was about to replace. The panel asks the browser first and
falls back to this once, and only for the value that came from the file. Nothing
is declared per site, and no path is ever taken from the caller — the handler
reads the field's own value out of the content, so the reachable set is exactly
the pictures the panel is showing.

The owner's home (`?home` on the content edge) adds three: every block is
**settled independently**, so a dead analytics instance costs the traffic
numbers and not the change list; the analytics **share link is derived** from
the instance's own `shareId` rather than configured, because configuration that
can be read from the thing it describes is configuration that can go stale; and
a failed deploy is reported in **the host's own words**, since "Deployment rate
limited — retry in 24 hours" is actionable where "something went wrong" is not.

In `./cms` the same is true of four more: the form model is generated in Zod's
**input** mode, because a content file may legitimately omit a defaulted field
and output mode would flag it as incomplete; content is **normalised once** so
that every later edit is a small diff, and `applyEdits` verifies its own output
round-trips before returning it; the allowlist is re-checked on **every**
request, not just at sign-in; and the whole document — never the individual
patch — is re-validated against the schema, because field-level checks would
let a client assemble values that are each valid and collectively wrong.
