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

Entry points are separate on purpose: a site importing handlers never pulls in
widget code, and the handler entries typecheck against WebWorker globals only —
no DOM, no Node built-ins.

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

## Development

```
npm install
npm run build   # tsc, two configs: server (WebWorker lib) + widget (DOM lib)
npm test        # vitest
```

Behaviours that look like oversights are deliberate and pinned by tests: the
honeypot succeeds quietly, a 422 on issue creation retries without labels, a
failed screenshot upload never loses the comment, and the rate limiter sweeps
its whole map above 500 addresses.
