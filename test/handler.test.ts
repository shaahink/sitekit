/* The behaviours that look like oversights and are not — the honeypot's
   quiet success, the 422 label retry, the swallowed screenshot failure —
   are pinned here so no future tidy-up can lose them. */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFeedbackHandler } from "../src/feedback/handler.js";
import type { FeedbackOptions } from "../src/feedback/types.js";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeHandler(overrides: Partial<FeedbackOptions> = {}) {
  return createFeedbackHandler({
    env: {
      token: "tok",
      repo: "shaahink/elfine-site",
      reviewKey: "secret",
      siteUrl: "https://elfine-site.vercel.app"
    },
    locales: [
      { prefix: "fr", name: "French", label: "fr" },
      { prefix: "en", name: "English" }
    ],
    ...overrides
  });
}

function makeRequest(body: unknown, options: { headers?: Record<string, string>; badJson?: boolean } = {}) {
  const headers: Record<string, string> = {
    origin: "https://elfine-site.vercel.app",
    host: "elfine-site.vercel.app",
    "content-length": "500",
    "x-forwarded-for": "203.0.113.5",
    ...options.headers
  };
  return {
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => {
      if (options.badJson) throw new SyntaxError("Unexpected token");
      return body;
    }
  } as unknown as Request;
}

const validPayload = {
  key: "secret",
  website: "",
  comment: "The gold feels too bright.",
  name: "Elfine",
  page: { path: "/fr/", lang: "fr" },
  target: { section: "Ateliers", sectionId: "ateliers" },
  client: { viewport: "390×844", dpr: 3, ua: "Safari" }
};

function issueResponse() {
  return new Response(JSON.stringify({ number: 12, html_url: "https://github.com/x/issues/12" }), {
    status: 201
  });
}

async function bodyOf(response: Response) {
  return JSON.parse(await response.text());
}

/** The JSON the handler sent to GitHub on the nth fetch call. */
function sentBody(n: number) {
  return JSON.parse(fetchMock.mock.calls[n]![1].body);
}

describe("GET", () => {
  it("reports configured when all three secrets are present", async () => {
    const { GET } = makeHandler();
    expect(await bodyOf(await GET())).toEqual({ ok: true, configured: true });
  });

  it("reports unconfigured when one is missing", async () => {
    const { GET } = makeHandler({ env: { token: "tok", repo: "r" } });
    expect(await bodyOf(await GET())).toEqual({ ok: true, configured: false });
  });
});

describe("POST gates", () => {
  it("503s when unconfigured", async () => {
    const { POST } = makeHandler({ env: {} });
    const response = await POST(makeRequest(validPayload));
    expect(response.status).toBe(503);
  });

  it("403s a missing or foreign origin", async () => {
    const { POST } = makeHandler();
    expect((await POST(makeRequest(validPayload, { headers: { origin: "" } }))).status).toBe(403);
    expect((await POST(makeRequest(validPayload, { headers: { origin: "https://evil.example" } }))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("413s an oversized declared body", async () => {
    const { POST } = makeHandler();
    const response = await POST(makeRequest(validPayload, { headers: { "content-length": "3000001" } }));
    expect(response.status).toBe(413);
  });

  it("400s malformed JSON", async () => {
    const { POST } = makeHandler();
    const response = await POST(makeRequest(null, { badJson: true }));
    expect(response.status).toBe(400);
    expect((await bodyOf(response)).error).toBe("Malformed request.");
  });

  it("lets the honeypot succeed quietly, filing nothing", async () => {
    const { POST } = makeHandler();
    const response = await POST(makeRequest({ ...validPayload, website: "https://spam.example" }));
    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({ ok: true, skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("401s the wrong key with the human message", async () => {
    const { POST } = makeHandler();
    const response = await POST(makeRequest({ ...validPayload, key: "stale" }));
    expect(response.status).toBe(401);
    expect((await bodyOf(response)).error).toContain("ask for a fresh link");
  });

  it("400s an empty or oversized comment", async () => {
    const { POST } = makeHandler();
    expect((await POST(makeRequest({ ...validPayload, comment: "  " }))).status).toBe(400);
    expect((await POST(makeRequest({ ...validPayload, comment: "x".repeat(5001) }))).status).toBe(400);
  });

  it("429s past the rate limit", async () => {
    const { POST } = makeHandler({ rateLimit: { max: 1, windowMs: 60_000 } });
    fetchMock.mockResolvedValue(issueResponse());
    expect((await POST(makeRequest(validPayload))).status).toBe(200);
    expect((await POST(makeRequest(validPayload))).status).toBe(429);
  });
});

describe("filing the issue", () => {
  it("files with base, locale and screenshot-free labels", async () => {
    fetchMock.mockResolvedValue(issueResponse());
    const { POST } = makeHandler();
    const response = await POST(makeRequest(validPayload));
    expect(await bodyOf(response)).toEqual({
      ok: true,
      number: 12,
      url: "https://github.com/x/issues/12"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const issue = sentBody(0);
    expect(issue.labels).toEqual(["feedback", "fr"]);
    expect(issue.title).toBe("Ateliers: The gold feels too bright");
    expect(issue.body).toContain("https://elfine-site.vercel.app/fr/#ateliers");
  });

  it("retries a 422 without labels rather than losing the note", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{"message":"Validation Failed"}', { status: 422 }))
      .mockResolvedValueOnce(issueResponse());
    const { POST } = makeHandler();
    const response = await POST(makeRequest(validPayload));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(0).labels).toEqual(["feedback", "fr"]);
    expect(sentBody(1).labels).toBeUndefined();
    expect(sentBody(1).title).toBe(sentBody(0).title);
  });

  it("502s when GitHub keeps refusing", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    const { POST } = makeHandler();
    const response = await POST(makeRequest(validPayload));
    expect(response.status).toBe(502);
    expect((await bodyOf(response)).error).toBe("Couldn't file that note.");
  });
});

describe("screenshots", () => {
  const withImage = { ...validPayload, image: "data:image/jpeg;base64,QUFBQQ==" };

  it("uploads first, then labels and embeds the screenshot", async () => {
    fetchMock.mockImplementation(async (url: any, init: any) => {
      const target = String(url);
      if (target.includes("/git/ref/heads/")) return new Response("{}", { status: 200 });
      if (target.includes("/contents/")) return new Response("{}", { status: 201 });
      if (target.endsWith("/issues")) return issueResponse();
      throw new Error(`unexpected call: ${init?.method} ${target}`);
    });
    const { POST } = makeHandler();
    const response = await POST(makeRequest(withImage));
    expect(response.status).toBe(200);
    const issueCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/issues"))!;
    const issue = JSON.parse(issueCall[1].body);
    expect(issue.labels).toEqual(["feedback", "fr", "screenshot"]);
    expect(issue.body).toContain("### Screenshot");
    expect(issue.body).toContain("/api/shot?p=screenshots%2F");
  });

  it("never loses the comment when the upload fails", async () => {
    fetchMock.mockImplementation(async (url: any) => {
      const target = String(url);
      if (target.includes("/git/ref/heads/")) return new Response("boom", { status: 500 });
      if (target.endsWith("/issues")) return issueResponse();
      throw new Error(`unexpected call: ${target}`);
    });
    const { POST } = makeHandler();
    const response = await POST(makeRequest(withImage));
    expect(response.status).toBe(200);
    const issueCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/issues"))!;
    const issue = JSON.parse(issueCall[1].body);
    expect(issue.labels).toEqual(["feedback", "fr"]);
    expect(issue.body).not.toContain("### Screenshot");
  });

  it("rejects an oversized image without touching GitHub, keeping the note", async () => {
    fetchMock.mockImplementation(async (url: any) => {
      const target = String(url);
      if (target.endsWith("/issues")) return issueResponse();
      throw new Error(`unexpected call: ${target}`);
    });
    const { POST } = makeHandler({ maxImageBase64: 4 });
    const response = await POST(makeRequest(withImage));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
