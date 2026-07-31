/* What the owner changed, and whether it went live.
   ---------------------------------------------------------------------------
   The editor has always been able to say "saved" and link the commit. It has
   never been able to answer the question an owner actually asks next, which is
   *is it on my site yet* — and in the minute or two before it is, the honest
   answer and the broken answer look identical.

   Both halves come from the credential already sitting in every deployment.
   The sk-feedback App holds Contents on these repos for the editor's own
   writes, and since 2026-07-28 it also holds Commit statuses, Checks and
   Deployments as read-only (SHAHIN.md #13). So this adds no variable, no
   second registration and nothing to rotate.

   **Vercel does not post a check run**, which 7.7's runbook originally said it
   did. Checked on `behrooz-website@6863c30`: `/commits/{sha}/check-runs`
   returns exactly one run, `build`, which is the site's own CI. Building "did
   it deploy" on that would show green the moment the tests passed and call it
   deployed. Vercel reports as a **commit status** with context `Vercel`, and
   separately as a deployment — the status is what this reads, because it
   carries the target URL and a description worth quoting verbatim (today, for
   the whole fleet, that description is "Deployment rate limited — retry in 24
   hours", which is exactly the sort of thing an owner should be told rather
   than left to wonder about). */

import { gh } from "../feedback/github.js";
import type { RepoAccess } from "./contents.js";

export interface Change {
  sha: string;
  /** The first line of the commit subject, as `git log` shows it. */
  subject: string;
  /** The subject rewritten for someone who has never seen a commit. Undefined
      when it was not one of ours — a hand commit keeps its own words rather
      than being dressed up as an owner's edit. */
  summary?: string;
  /** Who the *editor* recorded, which is not the commit author: content
      commits are authored by `sk-feedback[bot]`, and the person is named in
      the trailer. See handler.ts's commitMessage. */
  who?: string;
  at: string;
  /** The commit on github.com — omitted when the reader could not open it. A
      private repository's links are "Page not found" for an owner who has a
      Google account and no GitHub one, so `ownerHome` strips them. */
  url?: string;
}

export interface DeployState {
  /** `success`, `pending`, `failure`, `error`, or `unknown` when nothing has
      reported yet — which is the normal state for the first thirty seconds and
      must not be shown as a failure. */
  state: "success" | "pending" | "failure" | "error" | "unknown";
  /** Whatever the reporter said, verbatim. Worth showing: it is the difference
      between "still building" and "rate limited, retry in 24 hours". */
  description?: string;
  url?: string;
}

/* `Edit home.yaml: hero.title, hero.tagline` — the subject the editor writes.
   Parsed rather than re-derived so that the panel and `git log` cannot drift,
   and matched loosely enough that adding a field to the subject later degrades
   to showing the raw subject rather than to showing nothing. */
const EDIT_SUBJECT = /^Edit\s+(\S+?):\s*(.+?)(?:\s*\(\+(\d+)\s+pictures?\))?$/;
/* `Put home.en.yaml and 2 more back to how they were before 4ba488c` — the
   subject restore.ts writes. Parsed here rather than shown raw for the reason
   the edit subject is: a row in the owner's own list should not be the first
   place they meet a seven-character hexadecimal number. */
const PUT_BACK_SUBJECT =
  /^Put\s+(\S+?)(?:\s+and\s+(\d+)\s+more)?\s+back to how (?:it was|they were) before\s+[0-9a-f]{7,40}$/;
const TRAILER = /Changed by (.+?) <[^>]*> through the site editor\./;

/** The commits that touched an owner's content, most recent first.
    ---------------------------------------------------------------------------
    Filtered by path, because a content commit and a code commit are different
    events to the person reading this: an owner should see the sentence they
    changed, not the day somebody bumped a dependency. GitHub takes one `path`
    per request, so several collections cost several requests — at the two or
    three a site has, that is cheaper than fetching everything and filtering. */
export async function recentChanges(
  access: RepoAccess,
  paths: string[],
  limit = 5
): Promise<Change[]> {
  const unique = [...new Set(paths.filter(Boolean))];
  const settled = await Promise.allSettled(
    unique.map((path) => commitsUnder(access, path, limit))
  );

  const seen = new Map<string, Change>();
  const failures: string[] = [];
  for (const result of settled) {
    if (result.status !== "fulfilled") {
      failures.push((result.reason as Error)?.message ?? String(result.reason));
      continue;
    }
    /* A commit touching two collections arrives twice and is one change. */
    for (const change of result.value) seen.set(change.sha, change);
  }

  const changes = [...seen.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);

  /* An empty list is only safe to hand back if we actually looked everywhere.
     -----------------------------------------------------------------------
     This is where session 16's F3 really lived, and reading the code was not
     enough to find it: `ownerHome` settles this call so it can tell "nothing
     changed yet" from "we could not look", and both this function and
     `commitsUnder` below used to answer *both* questions with an empty array.
     Under the measured GitHub 500 nothing rejected anywhere — the owner was
     simply told, in an inviting sentence, that they had never changed anything.

     So a failure is only swallowed when something real came back with it: a
     partial list is true as far as it goes and is worth showing, where an empty
     one would be a claim about the whole history. GitHub takes one path per
     request, so a two-collection site can genuinely half-answer. */
  if (failures.length && !changes.length) {
    throw new Error(`recent changes unavailable: ${failures.join("; ")}`);
  }
  if (failures.length) {
    console.error("cms history: partial change list —", failures.join("; "));
  }
  return changes;
}

async function commitsUnder(access: RepoAccess, path: string, limit: number): Promise<Change[]> {
  const query = new URLSearchParams({ path, per_page: String(limit) });
  if (access.branch) query.set("sha", access.branch);

  const result = await gh(`/repos/${access.repo}/commits?${query}`, {
    token: access.token,
    userAgent: access.userAgent
  });
  /* Thrown rather than flattened to `[]`, which is the whole of F3's root: a
     500 and an empty directory are opposite answers and this returned the same
     value for both. The status travels in the message because it is the only
     thing that will ever appear in a function log about this. */
  if (!result.ok) {
    throw new Error(`commits under ${path}: ${result.status} ${result.text.slice(0, 120)}`);
  }
  if (!Array.isArray(result.data)) {
    throw new Error(`commits under ${path}: expected a list, got ${typeof result.data}`);
  }

  return result.data.map((commit: any) => describe(commit));
}

function describe(commit: any): Change {
  const message: string = commit.commit?.message ?? "";
  const subject = message.split("\n")[0] ?? "";
  const trailer = TRAILER.exec(message);
  const restored = PUT_BACK_SUBJECT.exec(subject);
  const parsed = restored ? null : EDIT_SUBJECT.exec(subject);
  const summary = restored ? humanizeRestore(restored) : parsed ? humanize(parsed) : undefined;

  return {
    sha: commit.sha,
    subject,
    ...(summary === undefined ? {} : { summary }),
    ...(trailer?.[1] ? { who: trailer[1] } : {}),
    at: commit.commit?.author?.date ?? commit.commit?.committer?.date ?? "",
    url: commit.html_url ?? ""
  };
}

/** `Edit home.yaml: hero.title, hero.tagline` → `Changed 2 things on home`.
    ---------------------------------------------------------------------------
    Deliberately not a list of paths. `hero.tagline` is the editor's word for a
    thing the owner knows as the sentence under their name, and a panel that
    says it is showing them the inside of the machine. The count is honest, the
    file name is the page, and the commit link is right there for anyone who
    wants the detail. */
function humanize(parsed: RegExpExecArray): string {
  const file = (parsed[1] ?? "").replace(/\.ya?ml$/, "");
  const fields = (parsed[2] ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  const more = /and (\d+) more/.exec(parsed[2] ?? "");
  const count = more ? fields.length - 1 + Number(more[1]) : fields.length;
  const pictures = Number(parsed[3] ?? 0);

  const things = count === 1 ? "1 thing" : `${count} things`;
  const photos = pictures ? ` and added ${pictures === 1 ? "a photograph" : `${pictures} photographs`}` : "";
  return `Changed ${things}${photos} on ${file}`;
}

/** `Put home.en.yaml and 1 more back to how they were before 4ba488c` →
    `Put home.en and 1 more back to how they were`. The sha comes off for the
    same reason the field list does above: the row is for the person who pressed
    the button, and what they need to recognise is which pages moved. */
function humanizeRestore(parsed: RegExpExecArray): string {
  const file = (parsed[1] ?? "").replace(/\.ya?ml$/, "");
  const more = Number(parsed[2] ?? 0);
  return more
    ? `Put ${file} and ${more} more back to how they were`
    : `Put ${file} back to how it was`;
}

/** Whether the site rebuilt for a commit.
    ---------------------------------------------------------------------------
    `unknown` rather than a guess when nothing has reported. The window between
    a commit landing and Vercel first saying anything is real, and it is
    precisely when an impatient owner is looking — calling it a failure there
    would teach them to distrust the panel within a minute of using it. */
export async function deployState(access: RepoAccess, sha: string): Promise<DeployState> {
  const result = await gh(`/repos/${access.repo}/commits/${sha}/status`, {
    token: access.token,
    userAgent: access.userAgent
  });
  /* 403 is the App without `statuses: read`, which is a configuration fact and
     not a deploy failure. Same answer as "nothing has reported yet": the panel
     says nothing rather than something wrong. */
  if (!result.ok) return { state: "unknown" };

  const statuses: any[] = Array.isArray(result.data?.statuses) ? result.data.statuses : [];
  /* The host's own status, not the aggregate. `state` at the top level folds
     in the site's CI, and "did my sentence go live" is not the same question
     as "did the tests pass" — 7.7's runbook conflated exactly these two. */
  const vercel = statuses.find((status) => /vercel/i.test(status.context ?? ""));
  if (!vercel) return { state: "unknown" };

  const state = ["success", "pending", "failure", "error"].includes(vercel.state)
    ? (vercel.state as DeployState["state"])
    : "unknown";

  return {
    state,
    ...(vercel.description ? { description: vercel.description } : {}),
    ...(vercel.target_url ? { url: vercel.target_url } : {})
  };
}
