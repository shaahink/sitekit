import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { gh } from "../src/feedback/github.js";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gh", () => {
  it("parses a JSON success", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ number: 12, html_url: "https://github.com/x" }), { status: 201 })
    );
    const result = await gh("/repos/o/r/issues", {
      token: "tok",
      userAgent: "test-agent",
      method: "POST",
      body: { title: "t" }
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
    expect(result.data.number).toBe(12);
  });

  it("survives a non-JSON error body", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 }));
    const result = await gh("/repos/o/r/issues", { token: "tok", userAgent: "test-agent" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.data).toBeNull();
    expect(result.text).toContain("Bad gateway");
  });

  it("truncates long error text to 400 characters", async () => {
    fetchMock.mockResolvedValue(new Response("x".repeat(1000), { status: 500 }));
    const result = await gh("/x", { token: "tok", userAgent: "test-agent" });
    expect(result.text.length).toBe(400);
  });

  it("sends auth, version and the configured user agent", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await gh("/user", { token: "tok", userAgent: "my-fleet-agent" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/user");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(init.headers["User-Agent"]).toBe("my-fleet-agent");
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init.body).toBeNull();
  });

  it("sets Content-Type only when there is a body", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await gh("/x", { token: "tok", userAgent: "a", method: "POST", body: { a: 1 } });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('{"a":1}');
  });
});
