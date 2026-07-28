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
| `@shaahink/sitekit/widget` | The review-mode widget's logic: element refinement, CSS paths, section/context extraction, image downscaling, the POST envelope. No chrome — each site owns its own DOM, strings and palette |
| `@shaahink/sitekit/credits` | The `sk` footer credit: anchor plus schema.org JSON-LD |
| `@shaahink/sitekit/headers` | The dual header emitter: one config, emitted as `vercel.json` and Cloudflare `_headers`/`_redirects` |
| `@shaahink/sitekit/seo` | Site URLs, canonicals and sitemaps from one source |
| `@shaahink/sitekit/analytics` | The Umami tag |
| `@shaahink/sitekit/cms` | The owner's editor, server side: Google ID token verification, a signed session cookie, a form model generated from a collection's Zod schema, and a comment-preserving YAML writer that commits through the GitHub App |
| `@shaahink/sitekit/editor` | The owner's editor, browser side: `mountEditor(element)` builds the whole panel from the form model. Chrome included — see below |
| `@shaahink/sitekit/editor/editor.css` | That panel's stylesheet, for a site to copy into `public/` |

Entry points are separate on purpose: a site importing handlers never pulls in
widget code, and the handler entries typecheck against WebWorker globals only —
no DOM, no Node built-ins.

### Why `./editor` ships chrome and `./widget` doesn't

The widget appears on pages a visitor sees, so each site owns its DOM, strings
and palette — that is PLAN goal 2, and it is a feature. The editor is one
owner's admin panel on one route, and four hand-maintained copies of it is
exactly what this package exists to prevent. CLAUDE.md's "no design system in
the kit" rule was scoped on 2026-07-28 to say so: it governs public pages.
Nobody's face is their admin panel.

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
npm run build   # tsc, three configs: server (WebWorker) + widget (DOM, ES2017)
                # + editor (DOM, ES2020), then the editor's stylesheet is copied
npm test        # vitest
```

Three configs because the three halves have different floors. Handlers must not
reach for `document` or a Node built-in, so they typecheck against WebWorker
globals only. The widget ships on public pages and stays at ES2017 to reach as
many visitors as the sites do. The editor is one route for one owner, so ES2020
is honest — and it needs the lib as well as the syntax.

`dist` is emptied before every build. `files: ["dist"]` publishes whatever is in
there, and `tsc` only ever adds, so a moved file used to ship forever.

Behaviours that look like oversights are deliberate and pinned by tests: the
honeypot succeeds quietly, a 422 on issue creation retries without labels, a
failed screenshot upload never loses the comment, and the rate limiter sweeps
its whole map above 500 addresses.

In `./cms` the same is true of four more: the form model is generated in Zod's
**input** mode, because a content file may legitimately omit a defaulted field
and output mode would flag it as incomplete; content is **normalised once** so
that every later edit is a small diff, and `applyEdits` verifies its own output
round-trips before returning it; the allowlist is re-checked on **every**
request, not just at sign-in; and the whole document — never the individual
patch — is re-validated against the schema, because field-level checks would
let a client assemble values that are each valid and collectively wrong.
