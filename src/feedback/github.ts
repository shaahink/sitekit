import { deadline, githubTimeout } from "../internal/upstream.js";

const API = "https://api.github.com";

export interface GhOptions {
  token: string;
  userAgent: string;
  method?: string;
  body?: unknown;
  /** Override the deadline. 0 removes it. See internal/upstream.ts — every
      call through here has one by default, and it defaults higher for a write
      than for a read because only one of the two is ambiguous when it is cut
      off. */
  timeoutMs?: number;
}

export interface GhResult {
  ok: boolean;
  status: number;
  /* Whatever GitHub returned; not every error is JSON, hence null. */
  data: any;
  text: string;
}

export async function gh(path: string, options: GhOptions): Promise<GhResult> {
  const { token, userAgent, method = "GET", body } = options;
  const signal = deadline(githubTimeout(method, options.timeoutMs));
  const response = await fetch(API + path, {
    method,
    ...(signal ? { signal } : {}),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": userAgent,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : null
  });

  const text = await response.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* not every error is JSON */ }

  return { ok: response.ok, status: response.status, data, text: text.slice(0, 400) };
}
