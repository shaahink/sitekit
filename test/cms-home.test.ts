import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { clearStatsTokenCache, ownerTraffic, websitePages } from "../src/analytics/stats.js";
import { contentPaths, ownerHome, statsCredential } from "../src/cms/home.js";
import { deployState, recentChanges } from "../src/cms/history.js";
import { fileRequest, MAX_REQUEST, RequestError } from "../src/cms/requests.js";
import { relative } from "../src/editor/home.js";
import { defaultStrings } from "../src/editor/strings.js";

const ACCESS = { repo: "shaahink/behrooz-website", token: "t", userAgent: "test" };

const UMAMI = {
  umamiUrl: "https://stats.example",
  umamiUsername: "sk-dashboard",
  umamiPassword: "secret"
};

/* Copied from the live instance on 2026-07-28 rather than invented — including
   the trailer, which is what tells the panel a commit was an owner's edit and
   not a hand commit. */
const OWNER_COMMIT = {
  sha: "4ba488c1111111111111111111111111111111111",
  html_url: "https://github.com/shaahink/shade-site/commit/4ba488c",
  commit: {
    author: { date: "2026-07-28T15:15:00Z" },
    message:
      "Edit home.yaml: hero.title, hero.tagline\n\nChanged by Shade Azarnoosh <a@example.com> through the site editor."
  }
};

const HAND_COMMIT = {
  sha: "81fdea02222222222222222222222222222222222",
  html_url: "https://github.com/shaahink/shade-site/commit/81fdea0",
  commit: {
    author: { date: "2026-07-28T02:09:00Z" },
    message: "Normalize the content, once, so every owner edit is a small diff"
  }
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

describe("contentPaths", () => {
  it("takes the directory of a multi-entry collection and the file of a single one", () => {
    expect(
      contentPaths({
        homePage: { schema: null as never, file: "src/content/pages/home.yaml" },
        works: { schema: null as never, dir: "src/content/works/" }
      })
    ).toEqual(["src/content/pages/home.yaml", "src/content/works"]);
  });

  it("does not repeat a directory two collections share", () => {
    expect(
      contentPaths({
        a: { schema: null as never, dir: "src/content/pages" },
        b: { schema: null as never, dir: "src/content/pages" }
      })
    ).toEqual(["src/content/pages"]);
  });
});

describe("statsCredential", () => {
  /* The whole of "degrade quietly" is decided here: any missing piece means no
     traffic block at all, rather than a request that fails somewhere the owner
     can see it. */
  it("is null unless all three variables and the website id are present", () => {
    expect(statsCredential(UMAMI, undefined)).toBeNull();
    expect(statsCredential({ ...UMAMI, umamiPassword: undefined }, "w1")).toBeNull();
    expect(statsCredential({}, "w1")).toBeNull();
    expect(statsCredential(UMAMI, "w1")).not.toBeNull();
  });

  it("takes a trailing slash off the instance URL, so the share link has one separator", () => {
    const resolved = statsCredential({ ...UMAMI, umamiUrl: "https://stats.example/" }, "w1");
    expect(resolved?.credential.baseUrl).toBe("https://stats.example");
  });
});

describe("websitePages", () => {
  it("asks for type=path, because v3 answers type=url with a bare 400", async () => {
    fetchMock.mockResolvedValueOnce(respond({ token: "t1" }));
    fetchMock.mockResolvedValueOnce(respond([{ x: "/", y: 5 }]));
    await websitePages({ baseUrl: "https://stats.example", username: "u", password: "p" }, "w1", {
      startAt: 1,
      endAt: 2
    });
    expect(fetchMock.mock.calls[1]![0]).toContain("type=path");
    expect(fetchMock.mock.calls[1]![0]).not.toContain("type=url");
  });

  it("names the columns, sorts by reads and keeps the top three", async () => {
    fetchMock.mockResolvedValueOnce(respond({ token: "t1" }));
    fetchMock.mockResolvedValueOnce(
      respond([
        { x: "/about.html", y: 1 },
        { x: "/", y: 5 },
        { x: "/showcase.html", y: 3 },
        { x: "/contact.html", y: 2 }
      ])
    );
    const pages = await websitePages(
      { baseUrl: "https://stats.example", username: "u", password: "p" },
      "w1",
      { startAt: 1, endAt: 2 }
    );
    expect(pages).toEqual([
      { path: "/", views: 5 },
      { path: "/showcase.html", views: 3 },
      { path: "/contact.html", views: 2 }
    ]);
  });
});

describe("ownerTraffic", () => {
  it("needs no team id — the per-website routes answer by id alone", async () => {
    fetchMock.mockResolvedValueOnce(respond({ token: "t1" }));
    /* A fresh Response per call: a body can only be read once, so a single
       mocked object is consumed by whichever caller gets there first. */
    fetchMock.mockImplementation(() =>
      Promise.resolve(respond({ id: "w1", name: "bez", domain: "bez.example", shareId: "abc" }))
    );
    const traffic = await ownerTraffic(
      { baseUrl: "https://stats.example", username: "u", password: "p" },
      "w1",
      { now: 1_000_000_000_000 }
    );
    expect(traffic.site.shareId).toBe("abc");
    for (const [url] of fetchMock.mock.calls) expect(String(url)).not.toContain("/teams/");
  });

  it("logs in once for a whole panel, not once per concurrent read", async () => {
    /* This panel is the reason single-flight exists: its three reads miss a
       cold cache in the same tick, and without it each posts the password. */
    fetchMock.mockResolvedValueOnce(respond({ token: "t1" }));
    fetchMock.mockImplementation(() =>
      Promise.resolve(respond({ id: "w1", name: "bez", domain: "bez.example", shareId: "abc" }))
    );
    await ownerTraffic(
      { baseUrl: "https://stats.example", username: "u", password: "p" },
      "w1",
      { now: 1_000_000_000_000 }
    );
    const logins = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/auth/login"));
    expect(logins).toHaveLength(1);
  });

  it("loses the page list rather than the visitor count when metrics fail", async () => {
    fetchMock.mockResolvedValueOnce(respond({ token: "t1" }));
    fetchMock.mockResolvedValueOnce(respond({ id: "w1", name: "b", domain: "d", shareId: null }));
    fetchMock.mockResolvedValueOnce(respond({ pageviews: 26, visitors: 5 }));
    fetchMock.mockResolvedValueOnce(respond({ pageviews: 40, visitors: 9 }));
    fetchMock.mockResolvedValueOnce(respond({ error: "no" }, 500));

    const traffic = await ownerTraffic(
      { baseUrl: "https://stats.example", username: "u", password: "p" },
      "w1",
      { now: 1_000_000_000_000 }
    );
    expect(traffic.pages).toEqual([]);
    expect(traffic.windows[0]?.current.visitors).toBe(5);
  });
});

describe("recentChanges", () => {
  it("rewrites the editor's own subject and leaves a hand commit its words", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(respond([OWNER_COMMIT, HAND_COMMIT])));
    const changes = await recentChanges(ACCESS, ["src/content/pages"]);

    expect(changes[0]?.summary).toBe("Changed 2 things on home");
    expect(changes[0]?.who).toBe("Shade Azarnoosh");
    /* A hand commit has no summary, so the panel shows the subject as written
       rather than dressing somebody's refactor up as an owner's edit. */
    expect(changes[1]?.summary).toBeUndefined();
    expect(changes[1]?.subject).toMatch(/^Normalize the content/);
  });

  it("counts an abbreviated subject's 'and N more' rather than the names it shows", async () => {
    fetchMock.mockResolvedValue(
      respond([
        {
          ...OWNER_COMMIT,
          commit: {
            author: { date: "2026-07-28T15:15:00Z" },
            message: "Edit home.yaml: a, b, c, and 4 more"
          }
        }
      ])
    );
    const [change] = await recentChanges(ACCESS, ["src/content/pages"]);
    expect(change?.summary).toBe("Changed 7 things on home");
  });

  it("says so when a save carried photographs", async () => {
    fetchMock.mockResolvedValue(
      respond([
        {
          ...OWNER_COMMIT,
          commit: {
            author: { date: "2026-07-28T15:15:00Z" },
            message: "Edit works.yaml: images[0].src (+2 pictures)"
          }
        }
      ])
    );
    const [change] = await recentChanges(ACCESS, ["src/content/works"]);
    expect(change?.summary).toBe("Changed 1 thing and added 2 photographs on works");
  });

  it("counts a commit touching two collections once", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(respond([OWNER_COMMIT])));
    const changes = await recentChanges(ACCESS, ["src/content/pages", "src/content/works"]);
    expect(changes).toHaveLength(1);
  });

  it("returns what it can when one path's request fails", async () => {
    fetchMock.mockResolvedValueOnce(respond({ message: "Not Found" }, 404));
    fetchMock.mockResolvedValueOnce(respond([OWNER_COMMIT]));
    const changes = await recentChanges(ACCESS, ["src/content/gone", "src/content/pages"]);
    expect(changes).toHaveLength(1);
  });
});

describe("deployState", () => {
  it("reads the host's status and not the aggregate, which folds in CI", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        respond({
          state: "failure",
          statuses: [
            {
              context: "Vercel",
              state: "success",
              description: "Deployment has completed",
              target_url: "https://v"
            }
          ]
        })
      )
    );
    expect(await deployState(ACCESS, "abc")).toEqual({
      state: "success",
      description: "Deployment has completed",
      url: "https://v"
    });
  });

  it("quotes a refusal verbatim, because the host's words are the actionable part", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        respond({
          state: "failure",
          statuses: [
            {
              context: "Vercel",
              state: "failure",
              description: "Deployment rate limited — retry in 24 hours."
            }
          ]
        })
      )
    );
    const state = await deployState(ACCESS, "abc");
    expect(state.description).toBe("Deployment rate limited — retry in 24 hours.");
  });

  it("is unknown, never a failure, when nothing has reported yet", async () => {
    fetchMock.mockResolvedValue(respond({ state: "pending", statuses: [] }));
    expect((await deployState(ACCESS, "abc")).state).toBe("unknown");
  });

  it("is unknown when the App lacks the permission, which is not a deploy failure", async () => {
    fetchMock.mockResolvedValue(respond({ message: "Resource not accessible by integration" }, 403));
    expect((await deployState(ACCESS, "abc")).state).toBe("unknown");
  });
});

describe("ownerHome", () => {
  it("keeps the change list when there is no analytics credential at all", async () => {
    fetchMock.mockResolvedValueOnce(respond([OWNER_COMMIT]));
    fetchMock.mockResolvedValueOnce(respond({ state: "success", statuses: [] }));
    const home = await ownerHome(ACCESS, { a: { schema: null as never, dir: "src/content/pages" } }, {});
    expect(home.changes).toHaveLength(1);
    expect(home.traffic).toBeUndefined();
    expect(home.shareUrl).toBeUndefined();
  });

  it("builds the share link from the instance's own shareId rather than from config", async () => {
    fetchMock.mockResolvedValueOnce(respond([OWNER_COMMIT])); // commits
    fetchMock.mockResolvedValueOnce(respond({ token: "t1" })); // umami login
    fetchMock.mockResolvedValueOnce(
      respond({ id: "w1", name: "bez", domain: "bez-website.vercel.app", shareId: "5a749940fb2c3369" })
    );
    fetchMock.mockImplementation(() => Promise.resolve(respond({ pageviews: 26, visitors: 5 })));

    const home = await ownerHome(
      ACCESS,
      { a: { schema: null as never, dir: "src/content/pages" } },
      UMAMI,
      { umamiWebsiteId: "w1", now: 1_000_000_000_000 }
    );
    /* The exact URL SHAHIN.md #5 recorded for Bruce, derived rather than held. */
    expect(home.shareUrl).toBe(
      "https://stats.example/share/5a749940fb2c3369/bez-website.vercel.app"
    );
  });
});

describe("fileRequest", () => {
  it("titles the issue from the first line and keeps the whole text in the body", async () => {
    fetchMock.mockResolvedValue(respond({ number: 12, html_url: "https://github.com/i/12" }, 201));
    await fileRequest(ACCESS, {
      text: "A workshops section\n\nThree photographs and a paragraph.",
      page: "/about.html",
      who: { name: "Bruce Nemeth", email: "b@example.com" }
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.title).toBe("A workshops section");
    expect(body.body).toContain("Three photographs and a paragraph.");
    expect(body.body).toContain("Asked by Bruce Nemeth <b@example.com>");
    expect(body.body).toContain("/about.html");
    expect(body.labels).toEqual(["content-request"]);
  });

  it("retries without labels on a 422, rather than losing the owner's words", async () => {
    fetchMock.mockResolvedValueOnce(respond({ message: "Validation Failed" }, 422));
    fetchMock.mockResolvedValueOnce(respond({ number: 13, html_url: "https://github.com/i/13" }, 201));
    const filed = await fileRequest(ACCESS, {
      text: "Something",
      who: { name: "B", email: "b@example.com" }
    });
    expect(filed.number).toBe(13);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).labels).toBeUndefined();
  });

  it("refuses an empty request and one longer than the box can send", async () => {
    await expect(
      fileRequest(ACCESS, { text: "   ", who: { name: "B", email: "b@e" } })
    ).rejects.toThrow(RequestError);
    await expect(
      fileRequest(ACCESS, { text: "x".repeat(MAX_REQUEST + 1), who: { name: "B", email: "b@e" } })
    ).rejects.toThrow(RequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("relative", () => {
  /* Coarse on purpose: an owner wants to know whether this was the change they
     just made, not the minute of it — and coarse in *their* day, which is why
     the boundary is local midnight rather than UTC's. That makes the fixtures
     local too: written as UTC instants, "yesterday at 23:00" is today for half
     the world, and this test would pass in London and fail in Tehran. */
  const at = (day: number, hour: number) => new Date(2026, 6, day, hour).toISOString();
  const now = new Date(2026, 6, 28, 20).getTime();

  it("reads as a person would say it", () => {
    expect(relative(at(28, 9), defaultStrings, now)).toBe("today");
    expect(relative(at(27, 23), defaultStrings, now)).toBe("yesterday");
    expect(relative(at(25, 10), defaultStrings, now)).toBe("3 days ago");
  });

  it("says nothing rather than 'Invalid Date' when the date is missing", () => {
    expect(relative("", defaultStrings, now)).toBe("");
  });
});
