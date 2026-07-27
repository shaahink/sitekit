import { describe, it, expect } from "vitest";
import { COOKIE_NAME, clearSession, issueSession, readSession } from "../src/cms/session.js";

const SECRET = "a-per-site-secret-that-nobody-else-has";
const NOW = 1_753_650_000_000;
const IDENTITY = { sub: "108134", email: "shaahin69@gmail.com", name: "Shahin Kiassat" };

/** The `Cookie` header a browser would send back for a given `Set-Cookie`. */
function echo(setCookie: string): string {
  return setCookie.split(";")[0] as string;
}

describe("issueSession", () => {
  it("sets the attributes that keep the cookie out of reach", async () => {
    const cookie = await issueSession(IDENTITY, { secret: SECRET, now: NOW });
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=3600");
    expect(cookie).toContain("Path=/");
    expect(cookie.startsWith(`${COOKIE_NAME}=`)).toBe(true);
  });

  it("honours a custom lifetime", async () => {
    const cookie = await issueSession(IDENTITY, { secret: SECRET, now: NOW, maxAgeSeconds: 60 });
    expect(cookie).toContain("Max-Age=60");
  });
});

describe("readSession", () => {
  it("reads back what it signed", async () => {
    const cookie = await issueSession(IDENTITY, { secret: SECRET, now: NOW });
    const session = await readSession(echo(cookie), { secret: SECRET, now: NOW });
    expect(session).toMatchObject({
      sub: "108134",
      email: "shaahin69@gmail.com",
      name: "Shahin Kiassat"
    });
  });

  it("finds its cookie among the others a site sets", async () => {
    const cookie = await issueSession(IDENTITY, { secret: SECRET, now: NOW });
    const header = `umami.cache=abc; ${echo(cookie)}; theme=dark`;
    expect(await readSession(header, { secret: SECRET, now: NOW })).not.toBeNull();
  });

  it("returns null when there is no cookie at all", async () => {
    expect(await readSession(null, { secret: SECRET, now: NOW })).toBeNull();
    expect(await readSession("theme=dark", { secret: SECRET, now: NOW })).toBeNull();
  });

  it("refuses a payload edited after signing", async () => {
    const cookie = await issueSession(IDENTITY, { secret: SECRET, now: NOW });
    const [name, value] = echo(cookie).split("=") as [string, string];
    const [, signature] = value.split(".") as [string, string];
    const forged = Buffer.from(
      JSON.stringify({ sub: "1", email: "attacker@example.com", name: "x", exp: NOW / 1000 + 999 })
    ).toString("base64url");
    const session = await readSession(`${name}=${forged}.${signature}`, {
      secret: SECRET,
      now: NOW
    });
    expect(session).toBeNull();
  });

  it("refuses a cookie signed with a different secret", async () => {
    const cookie = await issueSession(IDENTITY, { secret: "someone-elses-secret", now: NOW });
    expect(await readSession(echo(cookie), { secret: SECRET, now: NOW })).toBeNull();
  });

  it("refuses a cookie whose signature was dropped", async () => {
    const cookie = await issueSession(IDENTITY, { secret: SECRET, now: NOW });
    const value = (echo(cookie).split("=")[1] as string).split(".")[0] as string;
    expect(await readSession(`${COOKIE_NAME}=${value}`, { secret: SECRET, now: NOW })).toBeNull();
  });

  it("refuses a session past its expiry", async () => {
    const cookie = await issueSession(IDENTITY, { secret: SECRET, now: NOW, maxAgeSeconds: 60 });
    const later = NOW + 61 * 1000;
    expect(await readSession(echo(cookie), { secret: SECRET, now: later })).toBeNull();
  });

  it("treats a rotated secret as a signed-out browser, not an error", async () => {
    const cookie = await issueSession(IDENTITY, { secret: SECRET, now: NOW });
    const session = await readSession(echo(cookie), { secret: `${SECRET}-rotated`, now: NOW });
    expect(session).toBeNull();
  });
});

describe("clearSession", () => {
  it("expires the cookie with matching attributes, so the browser drops it", () => {
    const cookie = clearSession();
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });
});
