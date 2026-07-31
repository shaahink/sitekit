/* The issuer — sign-in on the one origin the fleet registered.
   ---------------------------------------------------------------------------
   Mounted by the auth origin (`sk-studio`) as a single route file, `api/handoff.ts`.
   Everything a site needs from it is derived from one URL, so a site's whole
   share of session 22 is `CMS_AUTH_ORIGIN` and a pin.

     GET  ?jwks=1                     the public keys, for any site verifying a ticket
     GET  ?ping=1                     is this origin answering, and can it issue
     GET  ?return=…&state=…[&lang=…]  the sign-in page, on the registered origin
     POST {credential, return, state} a Google ID token in, a ticket out

   **Why the page is HTML from a function rather than a page on the site.** Two
   reasons, both measured rather than preferred. `sk-works` ships its CSP as a
   `<meta http-equiv>` whose `img-src` is `'self'` only — Google's button needs
   its own frame, its own stylesheet and an avatar from `lh3.googleusercontent.com`,
   so a static page on that site would be a sign-in card that cannot render its
   own button, which is precisely the failure this whole session exists to end.
   A function response carries no meta tag and its own header, so this page's
   CSP is exactly what this page needs and nothing on the site changes. The
   second reason is that it makes the issuer entirely the kit's: mounting it is
   one file, and a future second auth origin inherits it whole.

   **This handler mints a ticket for any Google account that signs in**, and
   that looks wrong at review. It is Decision 4: a ticket asserts *who someone
   is*, not what they may do. The site's own `CMS_ALLOWLIST` refuses a stranger
   one step later, exactly as it refuses an unknown Google account today. The
   auth origin deliberately does not consult its *own* allowlist here, because
   that variable governs who may edit `sk-works` and conflating the two would
   quietly make one site's editor list the fleet's editor list. */

import { sameHost } from "../feedback/guards.js";
import { json } from "../feedback/http.js";
import { verifyIdToken } from "./google.js";
import { signTicket, ticketJwks, trimOrigin } from "./ticket.js";
import type { CmsEnv } from "./types.js";

export interface HandoffHandler {
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
}

export interface HandoffHandlerOptions {
  env: CmsEnv | (() => CmsEnv);
  /** How long a ticket lives, in seconds. Sixty by default, and Decision 3
      property 2 is the argument for not raising it. */
  ticketTtlSeconds?: number;
}

export function createHandoffHandler(options: HandoffHandlerOptions): HandoffHandler {
  const resolveEnv: () => CmsEnv =
    typeof options.env === "function" ? options.env : () => options.env as CmsEnv;

  async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const env = resolveEnv();

    /* Public, cacheable, and readable cross-origin: every site in the fleet
       fetches this from its own server to verify a ticket, and the editor
       fetches it from a browser to ask whether this origin is answering at all
       before it sends an owner here. Neither carries a credential. */
    if (url.searchParams.has("jwks")) {
      if (!env.ticketPrivateKey) {
        return open(json({ ok: false, error: "This origin does not issue tickets." }, 503));
      }
      let keys;
      try {
        keys = await ticketJwks(env.ticketPrivateKey);
      } catch (error) {
        console.error("handoff: signing key unreadable:", (error as Error).message);
        return open(json({ ok: false, error: "This origin cannot issue tickets." }, 503));
      }
      const response = new Response(JSON.stringify(keys), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          /* An hour, matching what internal/jwks.ts assumes when an issuer
             says nothing. The verifier refetches once on an unknown kid, so a
             rotation is not gated on this expiring. */
          "Cache-Control": "public, max-age=3600"
        }
      });
      return open(response);
    }

    /* For whatever watches the fleet, and not for a site: a site asks the
       JWKS route instead, because the question it actually needs answered is
       whether the keys it is about to verify against are still published.
       This one distinguishes *up but not configured* from *up*, which is a
       distinction only a person looking at a dashboard can act on. */
    if (url.searchParams.has("ping")) {
      return open(json({ ok: true, issuing: Boolean(issuerReady(env)) }));
    }

    const lang = pickLang(url.searchParams.get("lang"), request.headers.get("accept-language"));
    const words = WORDS[lang];

    if (!issuerReady(env)) {
      return page(lang, words.title, words.notConfigured, null);
    }

    const returnUrl = url.searchParams.get("return") ?? "";
    const state = url.searchParams.get("state") ?? "";
    if (!returnUrl || !state) {
      return page(lang, words.title, words.direct, null);
    }

    /* Decision 3 property 4, and the single check that separates a hand-off
       from a ticket vending machine. Without it `?return=https://evil.example`
       makes this an open redirector *that signs what it hands over*. */
    const site = allowedReturn(returnUrl, env.fleetOrigins);
    if (!site) {
      console.error(`handoff: refused return ${returnUrl}`);
      return page(lang, words.title, words.badReturn, null);
    }

    return page(lang, words.title, words.lead, {
      clientId: env.googleClientId as string,
      return: returnUrl,
      state,
      signingIn: words.signingIn,
      failed: words.failed
    });
  }

  async function POST(request: Request): Promise<Response> {
    const env = resolveEnv();
    if (!issuerReady(env)) {
      return json({ ok: false, error: "Sign-in is not configured yet." }, 503);
    }

    /* The page that posts here is served by this same origin, so the same
       origin check the rest of the kit uses applies unchanged. */
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (!origin || !sameHost(origin, host, env.allowedOrigin)) {
      return json({ ok: false, error: "Bad origin." }, 403);
    }

    let body: { credential?: unknown; return?: unknown; state?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ ok: false, error: "Malformed request." }, 400);
    }

    const credential = typeof body.credential === "string" ? body.credential : "";
    const returnUrl = typeof body.return === "string" ? body.return : "";
    const state = typeof body.state === "string" ? body.state : "";
    if (!credential) return json({ ok: false, error: "No credential." }, 400);
    if (!returnUrl || !state) return json({ ok: false, error: "Nothing to hand back to." }, 400);

    const site = allowedReturn(returnUrl, env.fleetOrigins);
    if (!site) {
      console.error(`handoff: refused return ${returnUrl}`);
      return json({ ok: false, error: "That site isn't in this fleet." }, 403);
    }

    /* `iss` is this origin as the request actually reached it, not a configured
       string. A site compares it against its own `CMS_AUTH_ORIGIN`, so reading
       it from the request means a preview of the auth origin issues tickets
       that say where they came from — and a site pointed at production simply
       refuses them, which is the correct answer rather than a confusing one. */
    const issuer = requestOrigin(request);

    let identity;
    try {
      identity = await verifyIdToken(credential, { clientId: env.googleClientId as string });
    } catch (error) {
      console.error("handoff: token rejected:", (error as Error).message);
      return json({ ok: false, error: "That sign-in didn't work." }, 401);
    }

    let ticket: string;
    try {
      ticket = await signTicket({
        privateKey: env.ticketPrivateKey as string,
        issuer,
        audience: site.origin,
        identity,
        ...(options.ticketTtlSeconds !== undefined
          ? { ttlSeconds: options.ticketTtlSeconds }
          : {})
      });
    } catch (error) {
      console.error("handoff: could not sign a ticket:", (error as Error).message);
      return json({ ok: false, error: "Sign-in is not configured yet." }, 503);
    }

    /* `state` is echoed back exactly as it arrived and is never trusted for
       anything here — only the site can say whether it matches the cookie it
       set before it redirected, which is Decision 3 property 5. */
    const back = new URL(site.url);
    back.searchParams.set("ticket", ticket);
    back.searchParams.set("state", state);
    return json({ ok: true, redirect: back.toString() });
  }

  function issuerReady(env: CmsEnv): boolean {
    return Boolean(env.googleClientId && env.ticketPrivateKey && env.fleetOrigins);
  }

  return { GET, POST };
}

/** The origin a request arrived at, as the browser named it.

    `new URL(request.url).origin` is not enough behind a proxy: the platform
    hands the function an internal http URL, and a ticket whose `iss` is
    `http://…` matches no site's `CMS_AUTH_ORIGIN` and is refused everywhere
    with a message about the issuer. The forwarded headers are what the browser
    actually asked for. */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, "");
  /* One value, not a list: a proxy chain may append, and the first hop is the
     one the browser spoke to. */
  return `${proto.split(",")[0]?.trim()}://${host.split(",")[0]?.trim()}`;
}

/** A `return` this origin is willing to sign for, or null.

    Exact origin matching, like Google's own, with one deliberate exception:
    an entry may carry a single `*` inside its host. The fleet's proof target is
    a Vercel **preview** deployment, whose host is minted per deployment
    (`sk-studio-<hash>-sheevajans-projects.vercel.app`) and cannot be written
    down in advance — so `https://*-sheevajans-projects.vercel.app` is the one
    way A1.3's write proof can run at all. The `*` may not match a dot, so it
    can never cross a label boundary, and the scheme is compared exactly; what
    it admits is bounded by who can create a host under that suffix, which for a
    Vercel team slug is us. Anything wider than that belongs nowhere near this
    function. */
export function allowedReturn(
  returnUrl: string,
  fleetOrigins: string | undefined
): { url: URL; origin: string } | null {
  if (!fleetOrigins) return null;

  let url: URL;
  try {
    url = new URL(returnUrl);
  } catch {
    return null;
  }
  /* `https:` only. A ticket travels in this URL and the session cookie it
     becomes is `Secure`, so a plaintext hop would be handing it away. */
  if (url.protocol !== "https:") return null;

  for (const raw of fleetOrigins.split(",")) {
    const entry = trimOrigin(raw);
    if (!entry) continue;
    if (matches(entry, url.origin)) return { url, origin: url.origin };
  }
  return null;
}

function matches(entry: string, origin: string): boolean {
  if (!entry.includes("*")) return entry === origin;
  const star = entry.indexOf("*");
  if (entry.indexOf("*", star + 1) !== -1) return false;
  const head = entry.slice(0, star);
  const tail = entry.slice(star + 1);
  /* A `*` is only meaningful in the host, and only after the scheme. */
  if (!head.startsWith("https://")) return false;
  if (!tail || tail.includes("/")) return false;
  /* **A `*` is a prefix within one label, never a whole one.** That single
     character is the difference between `https://*-sheevajans-projects.vercel.app`,
     which admits our own team's preview deployments, and `https://*.vercel.app`,
     which admits every site Vercel hosts. Session 22 measured Google refusing
     `sub.nimagiti.vercel.app` while accepting `nimagiti.vercel.app`; a
     subdomain wildcard here would be looser than the thing this replaces. */
  if (tail.startsWith(".")) return false;
  if (!origin.startsWith(head) || !origin.endsWith(tail)) return false;
  const middle = origin.slice(head.length, origin.length - tail.length);
  return middle.length > 0 && !middle.includes(".") && !middle.includes("/");
}

/* --- the page ---------------------------------------------------------- */

interface ButtonConfig {
  clientId: string;
  return: string;
  state: string;
  signingIn: string;
  failed: string;
}

function page(
  lang: Lang,
  title: string,
  lead: string,
  button: ButtonConfig | null
): Response {
  const nonce = scriptNonce();
  const dir = lang === "fa" ? "rtl" : "ltr";
  const body = button
    ? `<div id="sk-gbutton"></div><p id="sk-note" class="note" hidden></p>
<script nonce="${nonce}" src="https://accounts.google.com/gsi/client" async></script>
<script nonce="${nonce}">${clientScript(button)}</script>`
    : "";

  const html = `<!doctype html>
<html lang="${lang}" dir="${dir}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PAGE_CSS}</style>
<main>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(lead)}</p>
${body}
</main>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      /* Never cached and never in a frame: this is a sign-in. */
      "Cache-Control": "no-store",
      /* The ticket leaves here in a URL. `no-referrer` is what keeps this
         page's own `return` and `state` out of the Referer of anything Google
         loads, and Decision 3 property 2 names the Referer explicitly. */
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      /* Written out rather than borrowed from the site's own policy: this
         response has no `<meta http-equiv>` to merge with, and every source
         below is here because Google Identity Services needs it. `style-src`
         carries `'unsafe-inline'` and NO hash or nonce deliberately — beside a
         hash it would be spec-ignored, and Google injects its own `<style>`. */
      "Content-Security-Policy": [
        "default-src 'none'",
        `script-src 'nonce-${nonce}' https://accounts.google.com/gsi/client`,
        "connect-src 'self' https://accounts.google.com/gsi/",
        "frame-src https://accounts.google.com/gsi/",
        "style-src 'unsafe-inline' https://accounts.google.com/gsi/style",
        "img-src 'self' data: https://lh3.googleusercontent.com",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'"
      ].join("; ")
    }
  });
}

/** The whole of the page's behaviour: render Google's button, post what it
    hands back, follow where the server says to go. It is inline and nonced
    rather than a bundled file because this route is a function, not a build —
    there is nothing here to bundle it into. */
function clientScript(config: ButtonConfig): string {
  const cfg = jsonForScript({
    clientId: config.clientId,
    return: config.return,
    state: config.state,
    signingIn: config.signingIn,
    failed: config.failed
  });
  return `(function(){
var c=${cfg};
var slot=document.getElementById('sk-gbutton');
var note=document.getElementById('sk-note');
function say(t){note.textContent=t;note.hidden=false;}
function ready(){
  if(!window.google||!google.accounts||!google.accounts.id){return setTimeout(ready,120);}
  google.accounts.id.initialize({client_id:c.clientId,callback:function(r){send(r.credential);}});
  google.accounts.id.renderButton(slot,{type:'standard',theme:'outline',size:'large',text:'signin_with',width:Math.max(200,Math.min(400,slot.clientWidth||320))});
}
function send(credential){
  say(c.signingIn);
  fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential:credential,'return':c['return'],state:c.state})})
    .then(function(r){return r.json().then(function(b){return {ok:r.ok,body:b};});})
    .then(function(r){
      if(!r.ok||!r.body||!r.body.redirect){say((r.body&&r.body.error)||c.failed);return;}
      location.replace(r.body.redirect);
    })
    .catch(function(){say(c.failed);});
}
ready();
})();`;
}

/* Built with `new RegExp` from escapes rather than written as a regex
   literal, and that is not style. U+2028 and U+2029 **are** line terminators to
   a JavaScript parser, and a line terminator cannot appear inside a regex
   literal at all — so pasting them raw type-checked, emitted, and then threw
   `Invalid regular expression: missing /` when the module was imported, which
   took three unrelated test files down with it. */
const SEPARATORS = new RegExp("[\\u2028\\u2029]", "g");

/** JSON safe to sit inside a `<script>`: `<` escaped so no string in it can
    close the element, which is the one way a value here becomes markup. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    /* JSON permits U+2028 and U+2029 raw; JavaScript reads them as line
       terminators, so one inside a string would end the statement. */
    .replace(SEPARATORS, (c) => (c === "\u2028" ? "\\u2028" : "\\u2029"));
}


function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scriptNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/[^A-Za-z0-9]/g, "");
}

function open(response: Response): Response {
  const headers = new Headers(response.headers);
  /* Public keys and a liveness answer, both credential-free. `*` is the honest
     value: every site in the fleet and the editor in an owner's browser both
     ask, and enumerating them here would be a second fleet list to keep. */
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(response.body, { status: response.status, headers });
}

/* --- words ------------------------------------------------------------- */

type Lang = "en" | "fr" | "fa";

interface HandoffWords {
  title: string;
  lead: string;
  signingIn: string;
  failed: string;
  notConfigured: string;
  direct: string;
  badReturn: string;
}

/* Not the editor's string tables, and the reason is not oversight: those are a
   client bundle keyed to the panel's own sentences, and these five belong to a
   page the panel never renders. The register is the same — say what is
   happening and whose fault it is not. */
const WORDS: Record<Lang, HandoffWords> = {
  en: {
    title: "Sign in to edit your site",
    lead: "Sign in with Google here, and you'll go straight back to your own site.",
    signingIn: "Signing you in…",
    failed: "That sign-in didn't work. Try again.",
    notConfigured: "This sign-in isn't set up yet. Nothing is wrong with your site.",
    direct:
      "This page signs people in to the sites we look after. Open your own site's editor and it will send you here.",
    badReturn: "That site isn't one this sign-in looks after."
  },
  fr: {
    title: "Connectez-vous pour modifier votre site",
    lead: "Connectez-vous avec Google ici, et vous reviendrez directement sur votre site.",
    signingIn: "Connexion en cours…",
    failed: "Cette connexion n'a pas fonctionné. Réessayez.",
    notConfigured: "Cette connexion n'est pas encore configurée. Votre site n'a aucun problème.",
    direct:
      "Cette page connecte les personnes aux sites dont nous nous occupons. Ouvrez l'éditeur de votre site et il vous enverra ici.",
    badReturn: "Ce site n'est pas un de ceux dont cette connexion s'occupe."
  },
  fa: {
    title: "برای ویرایش سایتت وارد شو",
    lead: "همین‌جا با گوگل وارد شو، بعد یک‌راست به سایت خودت برمی‌گردی.",
    signingIn: "در حال وارد کردن…",
    failed: "این ورود نگرفت. دوباره امتحان کن.",
    notConfigured: "این ورود هنوز تنظیم نشده. سایت تو هیچ مشکلی ندارد.",
    direct:
      "این صفحه آدم‌ها را به سایت‌هایی که ما نگه‌شان می‌داریم وارد می‌کند. ویرایشگر سایت خودت را باز کن، خودش تو را می‌فرستد اینجا.",
    badReturn: "این سایت جزو سایت‌هایی نیست که این ورود نگه‌شان می‌دارد."
  }
};

/** The site says which language its owner reads; `Accept-Language` is the
    fallback for somebody who arrived without one. English last, because it is
    the language the fewest owners in this fleet actually read. */
function pickLang(param: string | null, acceptLanguage: string | null): Lang {
  const wanted = (param ?? "").slice(0, 2).toLowerCase();
  if (wanted === "fr" || wanted === "fa" || wanted === "en") return wanted;
  const header = (acceptLanguage ?? "").toLowerCase();
  for (const tag of header.split(",")) {
    const code = tag.trim().slice(0, 2);
    if (code === "fa" || code === "fr") return code;
    if (code === "en") return "en";
  }
  return "en";
}

/* Deliberately small and unbranded. This page belongs to the fleet, not to any
   one client, and an owner arriving from their own site should read it as a
   step rather than as somebody else's website. */
const PAGE_CSS = `:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;min-block-size:100vh;align-items:center;justify-content:center;padding:1.5rem}
main{max-inline-size:26rem;inline-size:100%}
h1{font-size:1.35rem;margin:0 0 .75rem}
p{margin:0 0 1.25rem;opacity:.85}
#sk-gbutton{display:flex;justify-content:center}
.note{margin-block-start:1rem;margin-block-end:0;font-size:.9rem}`;
