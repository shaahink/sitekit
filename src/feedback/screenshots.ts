/* Screenshot storage.
   ---------------------------------------------------------------------------
   Committed to an orphan branch that carries its own vercel.json turning
   deployments off, so uploads never trigger a build. */

import { gh } from "./github.js";

export interface ScreenshotContext {
  token: string;
  repo: string;
  branch: string;
  userAgent: string;
  maxImageBase64: number;
}

export async function uploadScreenshot(
  dataUrl: string,
  { token, repo, branch, userAgent, maxImageBase64 }: ScreenshotContext
): Promise<string> {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  if (!base64 || base64.length > maxImageBase64) throw new Error("image too large");

  await ensureBranch({ token, repo, branch, userAgent });

  const day = new Date().toISOString().slice(0, 10);
  const path = `screenshots/${day}/${randomId()}.jpg`;

  const put = await gh(`/repos/${repo}/contents/${path}`, {
    token,
    userAgent,
    method: "PUT",
    body: {
      message: `Screenshot for feedback (${day})`,
      content: base64,
      branch
    }
  });

  if (!put.ok) throw new Error(`upload ${put.status}: ${put.text}`);
  return path;
}

export async function ensureBranch(
  { token, repo, branch, userAgent }: Omit<ScreenshotContext, "maxImageBase64">
): Promise<void> {
  const ref = await gh(`/repos/${repo}/git/ref/heads/${branch}`, { token, userAgent });
  if (ref.ok) return;
  if (ref.status !== 404) throw new Error(`ref check ${ref.status}`);

  /* A parentless commit, so the branch holds screenshots and nothing else. */
  const tree = await gh(`/repos/${repo}/git/trees`, {
    token,
    userAgent,
    method: "POST",
    body: {
      tree: [
        {
          path: "README.md",
          mode: "100644",
          type: "blob",
          content:
            "# Feedback screenshots\n\n" +
            "Images attached to review-mode comments, uploaded by the feedback handler.\n" +
            "This branch is intentionally detached from the site's history and never deploys.\n"
        },
        {
          path: "vercel.json",
          mode: "100644",
          type: "blob",
          content: JSON.stringify({ git: { deploymentEnabled: false } }, null, 2) + "\n"
        }
      ]
    }
  });
  if (!tree.ok) throw new Error(`tree ${tree.status}: ${tree.text}`);

  const commit = await gh(`/repos/${repo}/git/commits`, {
    token,
    userAgent,
    method: "POST",
    body: { message: "Start feedback screenshot store", tree: tree.data.sha, parents: [] }
  });
  if (!commit.ok) throw new Error(`commit ${commit.status}: ${commit.text}`);

  const created = await gh(`/repos/${repo}/git/refs`, {
    token,
    userAgent,
    method: "POST",
    body: { ref: `refs/heads/${branch}`, sha: commit.data.sha }
  });
  /* 422 means something else created it a moment ago — that's fine. */
  if (!created.ok && created.status !== 422) {
    throw new Error(`ref ${created.status}: ${created.text}`);
  }
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
