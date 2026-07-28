import { describe, it, expect } from "vitest";
import {
  COOKIE_NAME,
  clearSession,
  issueSession,
  readSession,
  renewSession
} from "../src/cms/session.js";

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

describe("renewSession", () => {
  /* An hour is short on a phone: an owner opens their page on the bus, is
     interrupted, comes back after lunch and types. Sliding the expiry forward
     while they are working is what stops the first sign of that being a save
     that fails. */
  async function sessionAt(now: number, maxAgeSeconds = 3600) {
    const cookie = await issueSession(IDENTITY, { secret: SECRET, now, maxAgeSeconds });
    const value = cookie.split(";")[0] as string;
    return (await readSession(value, { secret: SECRET, now }))!;
  }

  it("leaves a fresh session alone", async () => {
    const session = await sessionAt(NOW);
    const renewed = await renewSession(session, { secret: SECRET, now: NOW + 60 * 1000 });
    expect(renewed).toBeNull();
  });

  it("still leaves it alone one second before halfway", async () => {
    const session = await sessionAt(NOW);
    const justBefore = NOW + (1800 - 1) * 1000;
    expect(await renewSession(session, { secret: SECRET, now: justBefore })).toBeNull();
  });

  it("mints a fresh hour once a session is past halfway", async () => {
    const session = await sessionAt(NOW);
    const past = NOW + 1801 * 1000;
    const renewed = await renewSession(session, { secret: SECRET, now: past });
    expect(renewed).toContain("Max-Age=3600");

    /* The renewed cookie is a working session in its own right, carrying the
       same person — not a re-signing of the old expiry. */
    const value = (renewed as string).split(";")[0] as string;
    const read = await readSession(value, { secret: SECRET, now: past });
    expect(read).toMatchObject({ sub: IDENTITY.sub, email: IDENTITY.email });
    expect(read!.exp).toBeGreaterThan(session.exp);
  });

  it("measures halfway against the site's own lifetime, not an assumed hour", async () => {
    const session = await sessionAt(NOW, 600);
    const options = { secret: SECRET, maxAgeSeconds: 600 };
    expect(await renewSession(session, { ...options, now: NOW + 200 * 1000 })).toBeNull();
    expect(await renewSession(session, { ...options, now: NOW + 400 * 1000 })).toContain(
      "Max-Age=600"
    );
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
