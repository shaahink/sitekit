/* Review mode — feedback intake
   ---------------------------------------------------------------------------
   Receives a note from a site's review-mode widget and files it as a GitHub
   issue. Any attached screenshot is committed to an orphan branch and served
   back through the site's /api/shot, so images render inline in the issue
   whether the repo is public or private.

   The person leaving the comment never touches GitHub — this handler acts on
   the repo owner's behalf with a server-side token, passed in via options. */

import type { FeedbackEnv, FeedbackOptions } from "./types.js";
import { installationToken } from "./app-auth.js";
import { createThrottle, safeEqual, sameHost } from "./guards.js";
import { gh } from "./github.js";
import { uploadScreenshot } from "./screenshots.js";
import { buildBody, buildTitle, trim } from "./format.js";
import { json } from "./http.js";

export interface FeedbackHandler {
  GET(request?: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
}

export function createFeedbackHandler(options: FeedbackOptions): FeedbackHandler {
  const resolveEnv: () => FeedbackEnv =
    typeof options.env === "function" ? options.env : () => options.env as FeedbackEnv;

  const locales = options.locales ?? [];
  const timeZone = options.timeZone ?? "UTC";
  const timestampLocale = options.timestampLocale ?? "en-GB";
  const userAgent = options.userAgent ?? "review-mode-feedback";
  const baseLabels = options.labels ?? ["feedback"];
  const screenshotLabel = options.screenshotLabel ?? "screenshot";
  const maxComment = options.maxComment ?? 5000;
  const maxBodyBytes = options.maxBodyBytes ?? 3_000_000;
  const maxImageBase64 = options.maxImageBase64 ?? 2_200_000;
  const rateLimit = options.rateLimit ?? { max: 15, windowMs: 10 * 60 * 1000 };

  const throttled = createThrottle(rateLimit);

  async function GET(): Promise<Response> {
    const env = resolveEnv();
    return json({
      ok: true,
      configured: Boolean(hasCredential(env) && env.repo && env.reviewKey)
    });
  }

  async function POST(request: Request): Promise<Response> {
    const env = resolveEnv();
    const repo = env.repo;
    const reviewKey = env.reviewKey;
    const branch = env.branch || "feedback-assets";

    if (!hasCredential(env) || !repo || !reviewKey) {
      return json({ ok: false, error: "Feedback is not configured yet." }, 503);
    }

    /* App auth wins over the PAT (see FeedbackEnv). Minting can fail —
       bad key, GitHub down — and that is a server problem, not the
       visitor's. */
    let token: string;
    try {
      token = await resolveToken(env, userAgent);
    } catch (error) {
      console.error("credential resolution failed:", (error as Error).message);
      return json({ ok: false, error: "Couldn't file that note." }, 502);
    }

    /* Only our own pages may post here. */
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (!origin || !sameHost(origin, host, env.allowedOrigin)) {
      return json({ ok: false, error: "Bad origin." }, 403);
    }

    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > maxBodyBytes) {
      return json({ ok: false, error: "That was too large to send." }, 413);
    }

    let payload: any;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: "Malformed request." }, 400);
    }

    /* The honeypot succeeds quietly — a bot that fills it learns nothing. */
    if (payload.website) return json({ ok: true, skipped: true });
    if (!safeEqual(String(payload.key || ""), reviewKey)) {
      return json({ ok: false, error: "Review mode has expired — ask for a fresh link." }, 401);
    }

    const comment = String(payload.comment || "").trim();
    if (!comment) return json({ ok: false, error: "Empty comment." }, 400);
    if (comment.length > maxComment) {
      return json({ ok: false, error: "That comment is too long." }, 400);
    }

    const ip = request.headers.get("x-forwarded-for") || "unknown";
    if (throttled(ip)) {
      return json({ ok: false, error: "Too many notes at once — give it a minute." }, 429);
    }

    const page = payload.page || {};
    const target = payload.target || {};
    const client = payload.client || {};
    const name = trim(payload.name, 60) || "Anonymous";
    const siteUrl = (env.siteUrl || `https://${host}`).replace(/\/+$/, "");

    /* Screenshot first, so its URL can go into the issue body. */
    let shotPath: string | null = null;
    if (typeof payload.image === "string" && payload.image.startsWith("data:image/")) {
      try {
        shotPath = await uploadScreenshot(payload.image, {
          token, repo, branch, userAgent, maxImageBase64
        });
      } catch (error) {
        console.error("screenshot upload failed:", (error as Error).message);
        /* A lost screenshot must never cost us the comment itself. */
      }
    }

    const issue: { title: string; body: string; labels: string[] } = {
      title: buildTitle(comment, target, page),
      body: buildBody(
        { comment, name, page, target, client, shotPath, siteUrl },
        { timeZone, timestampLocale, locales }
      ),
      labels: [...baseLabels]
    };
    const lang = String(page.lang || "").toLowerCase();
    const localeRule = locales.find((rule) => rule.label && lang.startsWith(rule.prefix));
    if (localeRule?.label) issue.labels.push(localeRule.label);
    if (shotPath) issue.labels.push(screenshotLabel);

    let created = await gh(`/repos/${repo}/issues`, { token, userAgent, method: "POST", body: issue });

    /* Labels that don't exist yet make the API unhappy — the note matters more. */
    if (!created.ok && created.status === 422) {
      created = await gh(`/repos/${repo}/issues`, {
        token,
        userAgent,
        method: "POST",
        body: { title: issue.title, body: issue.body }
      });
    }

    if (!created.ok) {
      console.error("issue creation failed:", created.status, created.text);
      return json({ ok: false, error: "Couldn't file that note." }, 502);
    }

    return json({ ok: true, number: created.data.number, url: created.data.html_url });
  }

  return { GET, POST };
}

function hasCredential(env: FeedbackEnv): boolean {
  return Boolean(env.token || (env.appId && env.appPrivateKey && env.appInstallationId));
}

async function resolveToken(env: FeedbackEnv, userAgent: string): Promise<string> {
  if (env.appId && env.appPrivateKey && env.appInstallationId) {
    return installationToken({
      appId: env.appId,
      privateKey: env.appPrivateKey,
      installationId: env.appInstallationId,
      userAgent
    });
  }
  return env.token as string;
}
