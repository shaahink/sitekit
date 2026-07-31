/* The sk credit line.
   ---------------------------------------------------------------------------
   The footer credit is the acquisition channel (PLAN §3.3), so it is emitted
   from one place: a visible anchor plus schema.org JSON-LD naming sk as the
   site's creator. Presentation stays with the site — the kit hands back
   markup with a class hook and no styling. */

export interface CreditsOptions {
  /** The client site's name, e.g. "Elfine". Goes into the JSON-LD. */
  siteName: string;
  /** The client site's canonical URL. Goes into the JSON-LD. */
  siteUrl: string;
  /** Where the credit points. Defaults to the studio site; changing this
      default and bumping the kit updates the fleet. */
  href?: string;
  /** The visible anchor text. Default "sk". */
  label?: string;
  /** How schema.org names the creator. Default "sk". */
  organizationName?: string;
  /** Class on the anchor, for the site's own styling. Default "sk-credit". */
  className?: string;
}

/* The credit is the acquisition channel, so it points at the work rather than
   at an inbox: a mailto asks a stranger to compose an email to somebody they
   have not decided to trust yet, where a link asks them to look. sk's own site
   went live on 2026-07-28 with four case studies on it, which is the thing
   worth reaching from five footers.

   It stays a bare `.vercel.app` deliberately. `sk.works` is registered when
   Shahin buys it (SHAHIN.md #10) and the swap is this constant plus a kit
   release — the same one-line change this was, and a redirect at the domain
   end means no footer is ever briefly wrong. */
const DEFAULT_HREF = "https://sk-works.vercel.app";

/** The visible link: `<a class="sk-credit" href="…" rel="author">sk</a>`.

    **Opens in a new tab, since 0.23.0.** This link sits on a client's page, and
    the client's interest and ours point the same way here: a visitor who taps
    it has not decided to leave — a footer credit is a curiosity, not a
    destination — and navigating them off a client's site to satisfy it is a
    cost the client pays for our benefit. A new tab is the version where
    nobody loses the page they were reading.

    `noopener` because a new tab otherwise gets a handle on this one. Not
    `noreferrer`: the referrer is the entire point of an acquisition channel,
    and stripping it would leave us unable to tell which client's site sent
    somebody. Modern browsers imply `noopener` for `target="_blank"` anyway;
    it is written out because "implied by the browsers we tested" is not the
    same claim as "stated". */
export function creditsAnchor(options: CreditsOptions): string {
  const href = options.href || DEFAULT_HREF;
  const label = options.label || "sk";
  const className = options.className || "sk-credit";
  return (
    `<a class="${escapeHtml(className)}" href="${escapeHtml(href)}"` +
    ` target="_blank" rel="author noopener">${escapeHtml(label)}</a>`
  );
}

/* The credit line, in the three languages the fleet's visitors read.
   ---------------------------------------------------------------------------
   Until 0.23.0 the kit handed back a bare anchor and each site wrapped it in
   its own words, which produced four different credits across five sites:
   behrooz said "Created by sk", shade put it after a copyright symbol,
   nimagiti and mosleh showed the bare name. Nobody decided that; it accreted.
   So the whole phrase moves here and the sites stop owning any of it.

   `{sk}` is where the anchor goes. A template with a placeholder rather than
   three concatenations, because the word order genuinely differs — Farsi puts
   the object first and the verb last, so "sk" is in the middle of the Persian
   sentence and at the start of the other two. Anything built by gluing a name
   to a suffix would have been wrong in Persian and looked fine in review.

   The register matches the fleet's own tables: French follows elfine's, Farsi
   follows nimagiti's. Neither is word-for-word; both say what the English
   says. */
const CREDIT_LINES: Record<string, string> = {
  en: "{sk} made this",
  fr: "{sk} a fait ce site",
  fa: "این سایت را {sk} ساخته"
};

/** The primary subtag, lowercased: `fa-IR` and `FA` both give `fa`. Split
    rather than prefix-matched, so `fao` is Faroese and not Farsi — the same
    bug the editor's own tables were careful about. */
function primary(lang: string | null | undefined): string {
  return (lang ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
}

export interface CreditLineOptions extends CreditsOptions {
  /** The page's language. Anything the kit has no line for falls back to
      English rather than to a blank — a site in a fourth language showing an
      English credit is a small oddity; one showing nothing at all has lost the
      acquisition channel PLAN §3.3 is built on. */
  lang?: string;
}

/** The visible credit, whole: `sk made this`, with `sk` as the link.
    Presentation still belongs to the site — this returns a `<span>` with a
    class hook and no styling of its own. */
export function creditLine(options: CreditLineOptions): string {
  const template = CREDIT_LINES[primary(options.lang)] ?? CREDIT_LINES["en"]!;
  const anchor = creditsAnchor(options);
  return `<span class="sk-creditline">${template.replace("{sk}", anchor)}</span>`;
}

/** The machine-readable claim: this WebSite's creator is the sk organisation. */
export function creditsJsonLd(options: CreditsOptions): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: options.siteName,
    url: options.siteUrl,
    creator: {
      "@type": "Organization",
      name: options.organizationName || "sk",
      url: options.href || DEFAULT_HREF
    }
  };
  /* "<" must not appear raw inside a script element. */
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

/** Anchor and JSON-LD together.

    Kept, and no longer what a footer should embed: `creditLine` plus
    `creditsJsonLd` is the pair a site wants since 0.23.0, because the sentence
    around the name is the kit's now rather than each site's. This stays
    exported so a bump cannot break a site that has not been converted yet —
    seven repos move on their own commits and a kit that broke the four it had
    not reached would be the worst possible way to ship a footer change. */
export function credits(options: CreditsOptions): string {
  return creditsAnchor(options) + creditsJsonLd(options);
}

/** The whole footer credit: the sentence, plus the machine-readable claim. */
export function creditsFor(options: CreditLineOptions): string {
  return creditLine(options) + creditsJsonLd(options);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
