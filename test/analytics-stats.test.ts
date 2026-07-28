import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  clearStatsTokenCache,
  fleetTraffic,
  percentChange,
  statsToken,
  teamWebsites,
  websiteStats
} from "../src/analytics/stats.js";

const CREDENTIAL = {
  baseUrl: "https://stats.example",
  username: "sk-dashboard",
  password: "secret",
  teamId: "team-1"
};

/* Shapes copied from the live instance rather than invented, including the
   fields this module ignores — a test that only contains what the code reads
   stops being evidence the moment the API adds something. */
const WEBSITE = {
  id: "site-1",
  name: "bez",
  domain: "bez-website.vercel.app",
  shareId: "5a749940fb2c3369",
  userId: null,
  teamId: "team-1",
  deletedAt: null
};

const STATS = {
  pageviews: 24,
  visitors: 5,
  visits: 11,
  bounces: 4,
  totaltime: 1437,
  comparison: { pageviews: 12, visitors: 4, visits: 6, bounces: 2, totaltime: 700 }
};

let fetchMock: ReturnType<typeof vi.fn>;

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

beforeEach(() => {
  clearStatsTokenCache();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("statsToken", () => {
  it("posts username and password, because v3 has no API-key concept", async () => {
    fetchMock.mockResolvedValueOnce(respond({ token: "t1" }));
    expect(await statsToken(CREDENTIAL)).toBe("t1");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://stats.example/api/auth/login");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ username: "sk-dashboard", password: "secret" });
  });

  it("caches on the warm instance, so a page of panels is one login", async () => {
    fetchMock.mockResolvedValueOnce(respond({ token: "t1" }));
    await statsToken(CREDENTIAL);
    await statsToken(CREDENTIAL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a refused login rather than returning an empty token", async () => {
    fetchMock.mockResolvedValueOnce(respond({ error: "nope" }, 401));
    await expect(statsToken(CREDENTIAL)).rejects.toThrow(/umami login: 401/);
  });
});

describe("teamWebsites", () => {
  it("enumerates through the team, not /api/websites", async () => {
    fetchMock
      .mockResolvedValueOnce(respond({ token: "t1" }))
      .mockResolvedValueOnce(respond({ data: [WEBSITE], count: 1 }));

    const sites = await teamWebsites(CREDENTIAL);
    expect(sites).toEqual([
      {
        id: "site-1",
        name: "bez",
        domain: "bez-website.vercel.app",
        shareId: "5a749940fb2c3369"
      }
    ]);
    expect(fetchMock.mock.calls[1]![0]).toContain("/api/teams/team-1/websites");
  });

  it("follows pages to the end — a truncated fleet is a site nobody measures", async () => {
    const page = (n: number) => ({
      data: [{ ...WEBSITE, id: `site-${n}`, name: `s${n}` }],
      count: 3
    });
    fetchMock
      .mockResolvedValueOnce(respond({ token: "t1" }))
      .mockResolvedValueOnce(respond(page(1)))
      .mockResolvedValueOnce(respond(page(2)))
      .mockResolvedValueOnce(respond(page(3)));

    expect(await teamWebsites(CREDENTIAL)).toHaveLength(3);
  });

  it("stops on an empty page rather than paging forever", async () => {
    fetchMock
      .mockResolvedValueOnce(respond({ token: "t1" }))
      .mockResolvedValueOnce(respond({ data: [], count: 99 }));

    expect(await teamWebsites(CREDENTIAL)).toEqual([]);
  });

  it("mints once more when a cached token has gone stale, and only once", async () => {
    fetchMock
      .mockResolvedValueOnce(respond({ token: "stale" }))
      .mockResolvedValueOnce(respond({}, 401))
      .mockResolvedValueOnce(respond({ token: "fresh" }))
      .mockResolvedValueOnce(respond({ data: [WEBSITE], count: 1 }));

    expect(await teamWebsites(CREDENTIAL)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("gives up on a credential that is genuinely wrong", async () => {
    fetchMock
      .mockResolvedValueOnce(respond({ token: "t1" }))
      .mockResolvedValueOnce(respond({}, 401))
      .mockResolvedValueOnce(respond({ token: "t2" }))
      .mockResolvedValueOnce(respond({}, 401));

    await expect(teamWebsites(CREDENTIAL)).rejects.toThrow(/401/);
  });
});

describe("websiteStats", () => {
  it("splits Umami's comparison block into the previous window", async () => {
    fetchMock
      .mockResolvedValueOnce(respond({ token: "t1" }))
      .mockResolvedValueOnce(respond(STATS));

    const result = await websiteStats(CREDENTIAL, "site-1", { startAt: 1000, endAt: 2000 });
    expect(result.current.visitors).toBe(5);
    expect(result.previous.visitors).toBe(4);
    expect(fetchMock.mock.calls[1]![0]).toContain("startAt=1000&endAt=2000");
  });

  it("reads a property with no traffic as zeroes, not undefined", async () => {
    fetchMock
      .mockResolvedValueOnce(respond({ token: "t1" }))
      .mockResolvedValueOnce(respond({}));

    const result = await websiteStats(CREDENTIAL, "site-1", { startAt: 1, endAt: 2 });
    expect(result.current).toEqual({
      pageviews: 0,
      visitors: 0,
      visits: 0,
      bounces: 0,
      totaltime: 0
    });
    expect(result.previous.visitors).toBe(0);
  });
});

describe("fleetTraffic", () => {
  it("windows back from now and reports every property", async () => {
    fetchMock
      .mockResolvedValueOnce(respond({ token: "t1" }))
      .mockResolvedValueOnce(respond({ data: [WEBSITE], count: 1 }))
      .mockResolvedValueOnce(respond(STATS));

    const now = Date.UTC(2026, 6, 28, 12, 0, 0);
    const traffic = await fleetTraffic(CREDENTIAL, { days: 7, now });

    expect(traffic.days).toBe(7);
    expect(traffic.readAt).toBe(new Date(now).toISOString());
    expect(traffic.sites[0]!.current.visitors).toBe(5);
    expect(traffic.sites[0]!.visitorChange).toBe(25);
    expect(fetchMock.mock.calls[2]![0]).toContain(`startAt=${now - 7 * 86_400_000}`);
  });

  it("keeps the panel when one property fails — that is the health panel's job", async () => {
    fetchMock
      .mockResolvedValueOnce(respond({ token: "t1" }))
      .mockResolvedValueOnce(
        respond({ data: [WEBSITE, { ...WEBSITE, id: "site-2", name: "shade" }], count: 2 })
      )
      .mockResolvedValueOnce(respond(STATS))
      .mockResolvedValueOnce(respond({}, 500))
      .mockResolvedValueOnce(respond({}, 500));

    const traffic = await fleetTraffic(CREDENTIAL, { now: 1_000_000_000 });
    expect(traffic.sites).toHaveLength(2);
    expect(traffic.sites[0]!.current.visitors).toBe(5);
    expect(traffic.sites[1]!.current.visitors).toBe(0);
  });
});

describe("percentChange", () => {
  it("rounds a real comparison", () => {
    expect(percentChange(5, 4)).toBe(25);
    expect(percentChange(4, 5)).toBe(-20);
  });

  it("answers null from an empty previous window — new is not a percentage", () => {
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });
});
