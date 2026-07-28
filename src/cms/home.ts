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
import type { RepoAccess } from "./contents.js";
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
  const [changesResult, trafficResult] = await Promise.allSettled([
    recentChanges(access, contentPaths(collections), 5),
    stats
      ? ownerTraffic(
          { ...stats.credential, ...(options.userAgent ? { userAgent: options.userAgent } : {}) },
          stats.websiteId,
          { days: [7, 30], ...(options.now === undefined ? {} : { now: options.now }) }
        )
      : Promise.resolve(undefined)
  ]);

  const changes = changesResult.status === "fulfilled" ? changesResult.value : [];
  const traffic = trafficResult.status === "fulfilled" ? trafficResult.value : undefined;

  const home: OwnerHome = { changes };

  const newest = changes[0];
  if (newest) {
    /* Only the newest. An owner asking "is it live yet?" means their last
       change; the deploy state of the one before is archaeology, and it is
       four more requests to answer a question nobody asked. */
    const state = await deployState(access, newest.sha).catch(() => undefined);
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
