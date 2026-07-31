// @vitest-environment happy-dom
/* The way in an owner is actually offered.
   ---------------------------------------------------------------------------
   `cms-auth-handoff` proves the server half refuses everything it should. This
   file proves the half an owner sees: which button exists on which site, that
   the one Decision 5 calls the failure that must not be silent — the auth
   origin not answering — is said in words rather than met as somebody else's
   error page, and that a refusal carried back in a query parameter becomes a
   sentence in the owner's own language.

   Driven against a stubbed `fetch` like editor-dom's, and asserting only what
   would fail silently: a control offered in a state it should not be, and a
   sentence said to the wrong failure. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountEditor } from "../src/editor/index.js";
import { editorStrings } from "../src/editor/strings.js";

const EN = editorStrings("en");
const FA = editorStrings("fa");
const AUTH = "https://sk.works";

interface Config {
  configured?: boolean;
  paths?: string[];
  clientId?: string;
  authOrigin?: string;
}

const BOTH: Config = {
  configured: true,
  paths: ["handoff", "google"],
  clientId: "1234.apps.googleusercontent.com",
  authOrigin: AUTH
};
const HANDOFF_ONLY: Config = { configured: true, paths: ["handoff"], authOrigin: AUTH };

/** Anything this page asked of a host that is not its own. It must stay empty:
    the editor's CSP would block it, and only in production. */
let pings: string[] = [];

function stub(config: Config): void {
  pings = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const href = String(url);
      if (!href.startsWith("/")) pings.push(href);
      if (href.startsWith("/api/auth")) return json(config);
      /* Signed out: the panel's first request is the session, and a 401 is what
         sends it to the sign-in screen. */
      return json({ error: "no" }, 401);
    })
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

async function signInScreen(options: Parameters<typeof mountEditor>[1] = {}): Promise<HTMLElement> {
  const root = document.createElement("main");
  document.body.append(root);
  await mountEditor(root, { lang: "en", ...options });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return root;
}

function press(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find(
    (button) => (button.textContent ?? "").trim() === label
  );
  if (!found) {
    const seen = [...root.querySelectorAll("button")].map((b) => b.textContent).join(" | ");
    throw new Error(`no button labelled "${label}" — found ${seen}`);
  }
  found.click();
  return found;
}

function shown(root: ParentNode): string {
  return (root.textContent ?? "").replace(/\s+/g, " ");
}

let assigned: string[] = [];

beforeEach(() => {
  assigned = [];
  document.body.innerHTML = "";
  vi.spyOn(window.location, "assign").mockImplementation((url: string) => {
    assigned.push(String(url));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the hand-off button", () => {
  it("is the only way in offered on a site with no Google client of its own", async () => {
    stub(HANDOFF_ONLY);
    const root = await signInScreen();
    expect(shown(root)).toContain(EN.signInHandoffNote);
    expect(press(root, EN.signInHandoff)).toBeTruthy();
    /* And Google's own note is not said, because there is no Google button
       under it — the empty rectangle is the thing session 22 is about. */
    expect(shown(root)).not.toContain(EN.signInNote);
    expect(shown(root)).not.toContain(EN.signInUnavailable);
  });

  it("leads, with Google's button kept as the fallback beneath it", async () => {
    stub(BOTH);
    const root = await signInScreen();
    const text = shown(root);
    /* Decision 5: prefer the hand-off wherever it exists, because a site
       cannot know whether its own origin is registered without asking Google. */
    expect(text.indexOf(EN.signInHandoffNote)).toBeLessThan(text.indexOf(EN.signInNote));
    expect(text).toContain(EN.signInOr);
  });

  it("goes to the site's own route and asks nothing of the sign-in origin", async () => {
    stub(HANDOFF_ONLY);
    const root = await signInScreen();
    press(root, EN.signInHandoff);
    await new Promise((resolve) => setTimeout(resolve, 0));

    /* Nothing cross-origin from this page, ever: its CSP declares
       `connect-src 'self' https://accounts.google.com`, so a request to the
       auth origin would be blocked in production and nowhere else. The site's
       own handler asks, server to server. */
    expect(pings).toEqual([]);
    expect(assigned).toHaveLength(1);
    const start = new URL(assigned[0] as string, "https://site.test");
    expect(start.origin).toBe("https://site.test");
    expect(start.pathname).toBe("/api/auth");
    expect(start.searchParams.get("handoff")).toBe("1");
    expect(start.searchParams.get("lang")).toBe("en");
    expect(start.searchParams.get("to")).toBe(location.pathname);
  });

  it("says the sign-in page is down when the site's handler sends them back saying so", async () => {
    /* The failure Decision 5 names. `cms-auth-handoff` proves the handler
       produces this redirect; this proves the owner reads a sentence. */
    window.happyDOM.setURL("https://site.test/edit?sk_auth=down");
    stub(HANDOFF_ONLY);
    const root = await signInScreen();
    expect(shown(root)).toContain(EN.signInHandoffDown);
    /* And the way in is still offered: this is "try in a few minutes", not a
       dead end. */
    expect(press(root, EN.signInHandoff)).toBeTruthy();
  });

  it("says it in the owner's language", async () => {
    window.happyDOM.setURL("https://site.test/edit?sk_auth=down");
    stub(HANDOFF_ONLY);
    const root = await signInScreen({ lang: "fa" });
    expect(shown(root)).toContain(FA.signInHandoffDown);
    expect(shown(root)).toContain(FA.signInHandoff);
    expect(document.documentElement.dir).toBe("rtl");
  });
});

describe("coming back refused", () => {
  it("says an account was turned away, on the owner's own site", async () => {
    /* The callback is a redirect and a redirect has no body, so the reason
       arrives as `?sk_auth=` and is said here. */
    window.happyDOM.setURL("https://site.test/edit?sk_auth=denied");
    stub(HANDOFF_ONLY);
    const root = await signInScreen();
    expect(shown(root)).toContain(EN.signInDenied);
  });

  it("says a sign-in did not work, which is a different sentence", async () => {
    window.happyDOM.setURL("https://site.test/edit?sk_auth=failed");
    stub(HANDOFF_ONLY);
    const root = await signInScreen();
    expect(shown(root)).toContain(EN.signInFailed);
    expect(shown(root)).not.toContain(EN.signInDenied);
  });

  it("does not carry the refusal into the next attempt", async () => {
    window.happyDOM.setURL("https://site.test/edit?sk_auth=denied&from=%2Fabout");
    stub(HANDOFF_ONLY);
    const root = await signInScreen();
    press(root, EN.signInHandoff);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const to = new URL(assigned[0] as string, "https://site.test").searchParams.get("to") as string;
    expect(to).not.toContain("sk_auth");
    /* Everything else about where they were survives. */
    expect(to).toContain("from=%2Fabout");
  });

  it("says nothing at all when nobody was refused", async () => {
    window.happyDOM.setURL("https://site.test/edit");
    stub(HANDOFF_ONLY);
    const root = await signInScreen();
    expect(shown(root)).not.toContain(EN.signInDenied);
    expect(shown(root)).not.toContain(EN.signInFailed);
  });
});
