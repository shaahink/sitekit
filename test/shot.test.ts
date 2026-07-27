import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SAFE_PATH, createShotHandler } from "../src/shot/index.js";

const HASH = "0123456789abcdef0123456789abcdef";

describe("SAFE_PATH", () => {
  it("accepts a well-formed screenshot path", () => {
    expect(SAFE_PATH.test(`screenshots/2026-07-27/${HASH}.jpg`)).toBe(true);
  });

  it("rejects traversal attempts", () => {
    expect(SAFE_PATH.test(`screenshots/2026-07-27/../../.env`)).toBe(false);
    expect(SAFE_PATH.test(`../screenshots/2026-07-27/${HASH}.jpg`)).toBe(false);
    expect(SAFE_PATH.test(`screenshots/2026-07-27/${HASH}.jpg/../x`)).toBe(false);
  });

  it("rejects other extensions", () => {
    expect(SAFE_PATH.test(`screenshots/2026-07-27/${HASH}.png`)).toBe(false);
    expect(SAFE_PATH.test(`screenshots/2026-07-27/${HASH}.jpg.html`)).toBe(false);
  });

  it("rejects the wrong hash length or alphabet", () => {
    expect(SAFE_PATH.test(`screenshots/2026-07-27/${HASH.slice(1)}.jpg`)).toBe(false);
    expect(SAFE_PATH.test(`screenshots/2026-07-27/${HASH}f.jpg`)).toBe(false);
    expect(SAFE_PATH.test(`screenshots/2026-07-27/${HASH.toUpperCase()}.jpg`)).toBe(false);
  });

  it("rejects arbitrary repo reads", () => {
    expect(SAFE_PATH.test("README.md")).toBe(false);
    expect(SAFE_PATH.test("api/feedback.js")).toBe(false);
  });
});

describe("createShotHandler", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const handler = createShotHandler({
    env: { token: "tok", repo: "shaahink/elfine-site" }
  });

  it("503s when unconfigured", async () => {
    const bare = createShotHandler({ env: {} });
    const response = await bare.GET(new Request("https://site/api/shot?p=x"));
    expect(response.status).toBe(503);
  });

  it("404s a bad path without touching GitHub", async () => {
    const response = await handler.GET(new Request("https://site/api/shot?p=../secrets"));
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies a good path from the assets branch, cached hard", async () => {
    fetchMock.mockResolvedValue(new Response("jpegbytes", { status: 200 }));
    const response = await handler.GET(
      new Request(`https://site/api/shot?p=screenshots/2026-07-27/${HASH}.jpg`)
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("/repos/shaahink/elfine-site/contents/screenshots/");
    expect(url).toContain("ref=feedback-assets");
  });

  it("404s when GitHub says no", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 403 }));
    const response = await handler.GET(
      new Request(`https://site/api/shot?p=screenshots/2026-07-27/${HASH}.jpg`)
    );
    expect(response.status).toBe(404);
  });
});
