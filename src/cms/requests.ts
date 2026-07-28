/* "Ask for something bigger" — the editor's other button.
   ---------------------------------------------------------------------------
   PLAN §3.9 draws a line: an owner edits words, pictures and whether a section
   appears; anything structural stays a conversation. That line is only honest
   if asking is easy. If the only tools on the page are "change this sentence"
   and "turn this section off", then an owner who wants a fourth section will
   reach for the tools they have — and the way that goes wrong is silent, in
   somebody's live content, on a Sunday.

   So the ask is a first-class action, and it lands where work is tracked
   rather than in an inbox. Session 10's agent loop reads these; the label is
   how it finds them, which is why it is a label and not a title convention.

   It deliberately reuses the review widget's shape rather than being a second
   implementation: the same repository, the same App credential, the same
   retry-without-labels fallback for a repository that has not got the label
   yet. What it does not reuse is the widget's *handler* — that one is open to
   anyone holding a review key, and this one is behind the owner's sign-in and
   files under their name. */

import { gh } from "../feedback/github.js";
import type { RepoAccess } from "./contents.js";

export const DEFAULT_REQUEST_LABEL = "content-request";

export interface ChangeRequest {
  /** What the owner typed. Required — an empty request is not a request. */
  text: string;
  /** The page they were looking at, site-relative. Context worth having and
      not worth insisting on: the ask may be about the site as a whole. */
  page?: string;
  /** Who is asking, from the session rather than from the payload. */
  who: { name: string; email: string };
}

export interface RequestResult {
  number: number;
  url: string;
}

/** The most an owner can type. Long enough for a real paragraph, short enough
    that a paste of an entire document does not become an issue body nobody
    reads. */
export const MAX_REQUEST = 4000;

export async function fileRequest(
  access: RepoAccess,
  request: ChangeRequest,
  label = DEFAULT_REQUEST_LABEL
): Promise<RequestResult> {
  const text = request.text.trim();
  if (!text) throw new RequestError("Nothing was written.");
  if (text.length > MAX_REQUEST) throw new RequestError("That is longer than this box can send.");

  const body = [
    text,
    "",
    "---",
    "",
    `Asked by ${request.who.name} <${request.who.email}> from the site editor`,
    ...(request.page ? [`On page: \`${request.page}\``] : [])
  ].join("\n");

  const payload = { title: title(text), body, labels: [label] };

  let result = await gh(`/repos/${access.repo}/issues`, {
    token: access.token,
    userAgent: access.userAgent,
    method: "POST",
    body: payload
  });

  /* A repository that has never seen this label answers 422 rather than
     creating it. The feedback handler learned this first; losing the owner's
     words to a missing label would be the worst possible trade. */
  if (result.status === 422) {
    const { labels: _labels, ...withoutLabels } = payload;
    result = await gh(`/repos/${access.repo}/issues`, {
      token: access.token,
      userAgent: access.userAgent,
      method: "POST",
      body: withoutLabels
    });
  }

  if (!result.ok) throw new RequestError(`file request: ${result.status} ${result.text}`);
  return { number: result.data?.number as number, url: result.data?.html_url as string };
}

/** The first line, trimmed to something an issue list can show. The whole text
    is in the body regardless, so this losing detail costs nothing. */
function title(text: string): string {
  const first = (text.split("\n").find((line) => line.trim()) ?? text).trim();
  return first.length > 72 ? `${first.slice(0, 69)}…` : first;
}

export class RequestError extends Error {}
