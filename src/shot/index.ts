/* Review mode — screenshot proxy
   ---------------------------------------------------------------------------
   Serves a screenshot stored on the feedback-assets branch so GitHub can
   render it inline inside a private repo's issues. GitHub's image proxy
   fetches URLs anonymously, so it can't read raw.githubusercontent.com for a
   private repo — but it can read this.

   Paths carry 128 bits of randomness, so a URL is effectively unguessable,
   but it is a public URL: anyone holding one can view that image. */

export const SAFE_PATH = /^screenshots\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{32}\.jpg$/;

export interface ShotEnv {
  /** Fine-grained PAT with Contents R on the site repo. */
  token?: string | undefined;
  /** The repo screenshots live in, as "owner/name". */
  repo?: string | undefined;
  /** Branch holding them. Defaults to "feedback-assets". */
  branch?: string | undefined;
}

export interface ShotOptions {
  /** Environment values, or a function returning them per request. */
  env: ShotEnv | (() => ShotEnv);
  /** User-Agent sent to the GitHub API. Default "review-mode-feedback". */
  userAgent?: string;
}

export interface ShotHandler {
  GET(request: Request): Promise<Response>;
}

export function createShotHandler(options: ShotOptions): ShotHandler {
  const resolveEnv: () => ShotEnv =
    typeof options.env === "function" ? options.env : () => options.env as ShotEnv;
  const userAgent = options.userAgent ?? "review-mode-feedback";

  async function GET(request: Request): Promise<Response> {
    const env = resolveEnv();
    const token = env.token;
    const repo = env.repo;
    const branch = env.branch || "feedback-assets";

    if (!token || !repo) return new Response("Not configured", { status: 503 });

    const path = new URL(request.url).searchParams.get("p") || "";
    if (!SAFE_PATH.test(path)) return new Response("Not found", { status: 404 });

    const response = await fetch(
      `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.raw",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": userAgent
        }
      }
    );

    if (!response.ok) return new Response("Not found", { status: 404 });

    return new Response(response.body, {
      headers: {
        "Content-Type": "image/jpeg",
        /* The path never changes contents, so cache it hard. */
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }

  return { GET };
}
