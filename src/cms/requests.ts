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
  /** Whether the label the agent loop reads by is actually on the issue. False
      is not the owner's problem — their words are filed either way — but it is
      somebody's, and see below for why nothing used to say so. */
  labelled: boolean;
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

  /* Insurance rather than a guard, and labelled as such since 0.16.0. The
     theory was that a repository which has never seen this label answers 422;
     measurement says GitHub creates the label as it files the issue, so this
     branch has never been reached by anything but its own test. It stays
     because losing the owner's paragraph to a label would be the worst trade
     on this route, and one unreached branch is a cheap premium. What it is
     *not* is the failure that actually happens — that one is below. */
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

  const number = result.data?.number as number;
  return {
    number,
    url: result.data?.html_url as string,
    labelled: await labelled(access, number, label, result.data)
  };
}

/* The failure that does happen, and used to happen in silence.
   ---------------------------------------------------------------------------
   Labels are a *write* to an issue, so an App installation without push access
   files the issue happily — 201, a number, a URL, an owner told their words
   arrived — and GitHub drops the `labels` from the payload without saying a
   word. Nothing in the response is an error. The issue is real and the owner
   is right to believe it landed.

   What is not real is the thing the label was for. Session 10's loop finds a
   request *by its label*, so a dropped label means an ask that exists, reads
   correctly to a human looking at the issue list, and is invisible to the only
   reader it was addressed to. That is the shape of fault this whole panel
   exists to avoid: not a break, an absence that reports success.

   So: read the labels back off the created issue rather than assuming them,
   try once to attach the label as its own write (which is the same permission,
   but it costs one request to be sure it is the permission and not the
   creation path), and if it still is not there, say so where an operator can
   see it — the function log — and hand the verdict back to the caller. */
async function labelled(
  access: RepoAccess,
  issue: number,
  label: string,
  created: unknown
): Promise<boolean> {
  if (carries(created, label)) return true;

  const added = await gh(`/repos/${access.repo}/issues/${issue}/labels`, {
    token: access.token,
    userAgent: access.userAgent,
    method: "POST",
    body: { labels: [label] }
  });
  if (added.ok && carries({ labels: added.data }, label)) return true;

  console.error(
    `cms: issue #${issue} was filed without the "${label}" label ` +
      `(adding it answered ${added.status}). The credential can create issues but not ` +
      `label them — an installation without push access — so anything reading requests ` +
      `by that label will not see this one.`
  );
  return false;
}

/** GitHub spells a label as an object with a name; a repository's own API has
    been seen to hand back plain strings, so both are read. */
function carries(issue: unknown, label: string): boolean {
  const labels = (issue as { labels?: unknown })?.labels;
  if (!Array.isArray(labels)) return false;
  return labels.some((entry) =>
    typeof entry === "string" ? entry === label : (entry as { name?: string })?.name === label
  );
}

/** The first line, trimmed to something an issue list can show. The whole text
    is in the body regardless, so this losing detail costs nothing. */
function title(text: string): string {
  const first = (text.split("\n").find((line) => line.trim()) ?? text).trim();
  return first.length > 72 ? `${first.slice(0, 69)}…` : first;
}

export class RequestError extends Error {}
