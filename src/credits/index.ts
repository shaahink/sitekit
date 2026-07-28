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

/** The visible link: `<a class="sk-credit" href="…" rel="author">sk</a>`. */
export function creditsAnchor(options: CreditsOptions): string {
  const href = options.href || DEFAULT_HREF;
  const label = options.label || "sk";
  const className = options.className || "sk-credit";
  return `<a class="${escapeHtml(className)}" href="${escapeHtml(href)}" rel="author">${escapeHtml(label)}</a>`;
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

/** Anchor and JSON-LD together — what a footer actually embeds. */
export function credits(options: CreditsOptions): string {
  return creditsAnchor(options) + creditsJsonLd(options);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
