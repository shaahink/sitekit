/* Reading the analytics instance — the other half of analytics/index.ts.
   ---------------------------------------------------------------------------
   `index.ts` emits the tag that collects. This reads back what was collected,
   server-side, so a dashboard can answer "did anyone come?" without embedding
   an iframe or rebuilding Umami's own UI.

   **It lives in the kit because it has two consumers.** Session 9's fleet
   dashboard wants every property in one view; session 7.7's owner's home wants
   one property, for the person whose site it is. Writing it in whichever repo
   got there first and copying it into the other is the exact failure SCALE.md
   measures — six copies of ci.yml are already three versions — so it is here,
   once, with the environment passed in as an argument and no framework
   anywhere near it.

   Three things about Umami v3 that cost an afternoon to learn and are not in
   its docs. All three are verified against the live instance, not recalled:

   1. **A team-owned website is invisible to `/api/websites`.** Both that route
      and `/api/me/websites` list *user*-owned sites and return 0 here — for the
      admin account too, since the transfer set `{ userId: null, teamId }`.
      Enumeration goes through the team. This looks exactly like a broken
      credential the first time you hit it.
   2. **There is no API-key concept.** No `/api/keys` route exists in v3, so the
      only way in is a username and password posted to `/api/auth/login`. That
      is why this takes a credential rather than a token, and why the account it
      is handed should be `view-only` — a login is not a scoped key, and this
      one is deliberately powerless: rename, delete and create all answer 401.
   3. **The token is opaque, not a JWT.** It carries no readable `exp`, so
      nothing here can schedule its own refresh. The cache is therefore a
      conservative TTL *plus* a single silent retry when the instance says 401 —
      belt and braces, because the failure mode of guessing the lifetime wrong
      is a dashboard that shows an error instead of a number. */

/** Where the instance is and who is reading it. */
export interface StatsCredential {
  /** Instance origin, no trailing slash — "https://sk-stats.vercel.app". */
  baseUrl: string;
  username: string;
  password: string;
  /** The team that owns the websites. See note 1 — without this there is
      nothing to enumerate, however valid the login is. */
  teamId: string;
  userAgent?: string;
}

/** A website as the instance describes it. `shareId` is the public link that
    was already sent to owners; it is passed through so a dashboard can link to
    the detail rather than reimplement it. */
export interface StatsWebsite {
  id: string;
  name: string;
  domain: string;
  shareId: string | null;
}

/** Umami's own numbers for a window, and the same numbers for the window
    before it. It returns the comparison unasked, which makes "up or down?"
    free — no second request, no date arithmetic here. */
export interface StatsTotals {
  pageviews: number;
  visitors: number;
  visits: number;
  bounces: number;
  totaltime: number;
}

export interface SiteTraffic extends StatsWebsite {
  current: StatsTotals;
  previous: StatsTotals;
  /** Percentage change in visitors against the previous equal window, or
      `null` when there is nothing to compare against. Null is not zero: a site
      going from no visitors to five has not risen by 0%, and it has not risen
      by infinity either — it is new, and only the caller can word that. */
  visitorChange: number | null;
}

export interface FleetTraffic {
  /** When the numbers were read, so "as of" means the read and not the render. */
  readAt: string;
  days: number;
  sites: SiteTraffic[];
}

const DEFAULT_USER_AGENT = "sitekit-stats";

/* Warm-instance cache, the same shape and for the same reason as the GitHub
   App's installation tokens in feedback/app-auth.ts: it survives requests on
   one instance, vanishes with it, and a cold login costs one round-trip.

   The TTL is a guess and is meant to be — see note 3. It is deliberately well
   short of any plausible server-side lifetime so that expiry is normally
   handled by this clock rather than by a failed request. */
const TOKEN_TTL_MS = 50 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();

/** A bearer token for the instance, minted or cached. */
export async function statsToken(credential: StatsCredential): Promise<string> {
  const key = `${credential.baseUrl}/${credential.username}`;
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.token;
  return mint(credential, key);
}

async function mint(credential: StatsCredential, key: string): Promise<string> {
  const response = await fetch(`${credential.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": credential.userAgent || DEFAULT_USER_AGENT
    },
    body: JSON.stringify({ username: credential.username, password: credential.password })
  });
  if (!response.ok) {
    throw new Error(`umami login: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  const data = (await response.json()) as { token?: string };
  if (!data.token) throw new Error("umami login: no token in response");
  cache.set(key, { token: data.token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return data.token;
}

/** Test seam, and the way a caller forces a fresh login. */
export function clearStatsTokenCache(): void {
  cache.clear();
}

/* Every read goes through here so the 401 retry exists in exactly one place.
   A stale cached token is indistinguishable from a wrong password until the
   instance answers, and answering "unauthorized" to the dashboard when a
   second login would have worked is the kind of error that gets a panel
   mistrusted. Retried once, and once only — a genuinely bad credential must
   fail rather than loop. */
async function read(credential: StatsCredential, path: string): Promise<any> {
  const key = `${credential.baseUrl}/${credential.username}`;
  const attempt = async (token: string) =>
    fetch(`${credential.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": credential.userAgent || DEFAULT_USER_AGENT
      }
    });

  let response = await attempt(await statsToken(credential));
  if (response.status === 401) {
    cache.delete(key);
    response = await attempt(await mint(credential, key));
  }
  if (!response.ok) {
    throw new Error(`umami ${path}: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  return response.json();
}

/** Every website the team owns.
    ---------------------------------------------------------------------------
    Paginated, and followed to the end rather than asked for one big page. The
    instance defaults to 20 per page and answers with a `count`, so at six
    properties this is one request and at twenty-five it is two — which is the
    only reason it is written this way, since the fleet is heading for twenty
    and a silently truncated list is a site that stops being measured without
    anything saying so. */
export async function teamWebsites(credential: StatsCredential): Promise<StatsWebsite[]> {
  const websites: StatsWebsite[] = [];
  let page = 1;
  for (;;) {
    const body = (await read(
      credential,
      `/api/teams/${credential.teamId}/websites?page=${page}&pageSize=100`
    )) as { data?: any[]; count?: number };
    const batch = body.data ?? [];
    for (const site of batch) {
      websites.push({
        id: site.id,
        name: site.name,
        domain: site.domain,
        shareId: site.shareId ?? null
      });
    }
    if (batch.length === 0 || websites.length >= (body.count ?? websites.length)) break;
    page++;
  }
  return websites;
}

/** Totals for one website over a window, with the previous window alongside. */
export async function websiteStats(
  credential: StatsCredential,
  websiteId: string,
  range: { startAt: number; endAt: number }
): Promise<{ current: StatsTotals; previous: StatsTotals }> {
  const body = (await read(
    credential,
    `/api/websites/${websiteId}/stats?startAt=${range.startAt}&endAt=${range.endAt}`
  )) as StatsTotals & { comparison?: StatsTotals };

  return {
    current: totals(body),
    previous: totals(body.comparison ?? {})
  };
}

/** Every property in one view — what a dashboard actually renders.
    ---------------------------------------------------------------------------
    One site failing does not fail the call. A property that has never received
    a hit, or that the instance is unhappy about, comes back as zeroes rather
    than as a rejected promise, because a traffic panel is not the place a
    reader should first learn that one upstream is unwell — the health panel
    is, and it is a different question.

    `now` is injectable so a test can pin the window without waiting a day. */
export async function fleetTraffic(
  credential: StatsCredential,
  options: { days?: number; now?: number } = {}
): Promise<FleetTraffic> {
  const days = options.days ?? 7;
  const endAt = options.now ?? Date.now();
  const startAt = endAt - days * 24 * 60 * 60 * 1000;

  const websites = await teamWebsites(credential);
  const settled = await Promise.allSettled(
    websites.map((site) => websiteStats(credential, site.id, { startAt, endAt }))
  );

  const sites = websites.map((site, index) => {
    const result = settled[index];
    const stats =
      result && result.status === "fulfilled"
        ? result.value
        : { current: totals({}), previous: totals({}) };
    return {
      ...site,
      current: stats.current,
      previous: stats.previous,
      visitorChange: percentChange(stats.current.visitors, stats.previous.visitors)
    };
  });

  return { readAt: new Date(endAt).toISOString(), days, sites };
}

/** Missing is zero — a property with no traffic omits fields rather than
    sending them as 0, and a dashboard that renders "undefined visitors"
    because of that is not worth the request it made. */
function totals(source: Partial<StatsTotals>): StatsTotals {
  return {
    pageviews: source.pageviews ?? 0,
    visitors: source.visitors ?? 0,
    visits: source.visits ?? 0,
    bounces: source.bounces ?? 0,
    totaltime: source.totaltime ?? 0
  };
}

/** Null rather than a number when the previous window was empty. See
    `visitorChange` — the caller words "new", because only the caller knows
    whether it is talking to an owner or to a fleet operator. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
