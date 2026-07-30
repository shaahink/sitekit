/* The owner's home — everything the editor knows about them, in one answer.
   ---------------------------------------------------------------------------
   7.7's whole point: an owner should have one URL, not three in an email. The
   editor already had the third of those (edit your words); this assembles the
   other two — did anyone come, and did my last change go live — plus the
   review link they were sent separately.

   **It is served from the content edge rather than from an endpoint of its
   own.** A second `api/` file would be a second file in every site repo, and
   the last time the editor had a per-site file it cost four client-repo
   commits in one afternoon (SCALE.md §9). A site gains no file for this; it
   gains three environment variables and one constant it already had.

   **Nothing here may fail the page.** Every block is settled independently and
   an absent one is absent, not an error: an owner who came to fix a typo must
   never be shown an analytics outage. The panel renders what arrived. */

import { ownerTraffic, type OwnerTraffic } from "../analytics/stats.js";
import { deployState, recentChanges, type Change, type DeployState } from "./history.js";
import { repoIsPublic, type RepoAccess } from "./contents.js";
import type { CmsEnv, CollectionConfig } from "./types.js";

export interface OwnerHome {
  /** The owner's five most recent content changes, newest first. */
  changes: Change[];
  /** Whether the newest of those is on the site yet. Absent when there is
      nothing to report about, which includes "nothing has been changed yet". */
  deploy?: DeployState;
  /** Their traffic, and their site as the instance knows it. Absent when there
      is no credential, no website id, or the instance did not answer. */
  traffic?: OwnerTraffic;
  /** The permanent read-only analytics link that needs no account — built from
      the instance's own `shareId` rather than configured, so it cannot go
      stale against a regenerated link. */
  shareUrl?: string;
  /** Whether a github.com link works for whoever is reading this panel. False
      on every private repository, which is all four client sites — the editor
      uses it to decide whether to offer a link to a filed request. */
  linkable: boolean;
  /** Blocks that could not be read, as opposed to blocks with nothing in them.

      The distinction is the whole of it. `changes: []` means one of two
      opposite things — nothing has been changed yet, or GitHub did not answer —
      and the panel said the first one out loud during a measured GitHub outage:
      "Nothing changed yet. Pick a page below and try something." Telling an
      owner something false about their own history is the failure; an empty
      array cannot carry the difference, so this does.

      Named per block rather than as one flag, because the panel treats them
      differently on purpose: it says so for the change list and stays quiet
      about traffic, which is 7.7's rule that an owner who came to fix a typo is
      not shown an analytics outage. */
  unavailable?: Array<"changes" | "traffic">;
}

/* A change with no link left on it. The panel guards on the url being present,
   so this is how a link stops being offered. */
function withoutUrl(change: Change): Change {
  const { url: _url, ...rest } = change;
  return rest;
}

/** Every content path the collections cover — what "the owner's changes" means
    for this site. A directory collection contributes the directory; a
    single-file one contributes the file, and GitHub is happy to filter on
    either. */
export function contentPaths(collections: Record<string, CollectionConfig>): string[] {
  const paths = new Set<string>();
  for (const config of Object.values(collections)) {
    const path = config.dir ?? config.file;
    if (path) paths.add(path.replace(/\/+$/, ""));
  }
  return [...paths];
}

export function statsCredential(env: CmsEnv, websiteId?: string) {
  if (!env.umamiUrl || !env.umamiUsername || !env.umamiPassword || !websiteId) return null;
  return {
    credential: {
      baseUrl: env.umamiUrl.replace(/\/+$/, ""),
      username: env.umamiUsername,
      password: env.umamiPassword
    },
    websiteId
  };
}

export async function ownerHome(
  access: RepoAccess,
  collections: Record<string, CollectionConfig>,
  env: CmsEnv,
  options: { umamiWebsiteId?: string; userAgent?: string; now?: number } = {}
): Promise<OwnerHome> {
  const stats = statsCredential(env, options.umamiWebsiteId);

  /* Settled, not awaited together: GitHub being slow must not cost the traffic
     block and an unwell analytics instance must not cost the change list. They
     are two different questions and they fail separately. */
  const [changesResult, trafficResult, publicResult] = await Promise.allSettled([
    recentChanges(access, contentPaths(collections), 5),
    stats
      ? ownerTraffic(
          { ...stats.credential, ...(options.userAgent ? { userAgent: options.userAgent } : {}) },
          stats.websiteId,
          { days: [7, 30], ...(options.now === undefined ? {} : { now: options.now }) }
        )
      : Promise.resolve(undefined),
    repoIsPublic(access)
  ]);

  /* Every rejection is logged, and that is a fix rather than housekeeping.
     `allSettled` discards the reason unless somebody reads it, so a measured
     GitHub outage and a measured analytics outage both left the function log
     completely empty — the block was invisible on screen by design and
     invisible to an operator by omission, which is how "nobody watches /admin
     at 3am" becomes "nobody could have known". */
  const failed = (block: string, result: PromiseSettledResult<unknown>): boolean => {
    if (result.status !== "rejected") return false;
    console.error(`cms home: ${block} unavailable:`, (result.reason as Error)?.message ?? result.reason);
    return true;
  };

  const unavailable: Array<"changes" | "traffic"> = [];
  if (failed("changes", changesResult)) unavailable.push("changes");
  if (failed("traffic", trafficResult)) unavailable.push("traffic");
  /* Not owner-visible: a repository we could not classify is treated as
     private, which is the safe answer and removes a link rather than adding a
     wrong one. Still logged — it is the one of the three whose failure is
     silent *by design*, so the log is the only place it can be seen. */
  failed("repo visibility", publicResult);

  const traffic = trafficResult.status === "fulfilled" ? trafficResult.value : undefined;
  /* A commit link the owner cannot open is worse than no link: "See exactly
     what changed" is the promise they are most nervous about, and on every
     private repo in the fleet it answered "Page not found". The panel guards on
     the url being there, so removing it removes the link — see repoIsPublic. */
  const linkable = publicResult.status === "fulfilled" && publicResult.value;
  const changes = (changesResult.status === "fulfilled" ? changesResult.value : []).map(
    (change) => (linkable ? change : withoutUrl(change))
  );

  const home: OwnerHome = { changes, linkable, ...(unavailable.length ? { unavailable } : {}) };

  const newest = changes[0];
  if (newest) {
    /* Only the newest. An owner asking "is it live yet?" means their last
       change; the deploy state of the one before is archaeology, and it is
       four more requests to answer a question nobody asked. */
    const state = await deployState(access, newest.sha).catch((error: Error) => {
      console.error("cms home: deploy state unavailable:", error?.message ?? error);
      return undefined;
    });
    if (state && state.state !== "unknown") home.deploy = state;
  }

  if (traffic) {
    home.traffic = traffic;
    if (traffic.site.shareId && stats) {
      home.shareUrl = `${stats.credential.baseUrl}/share/${traffic.site.shareId}/${traffic.site.domain}`;
    }
  }

  return home;
}
