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
  /** Where the credit points. Defaults to email until the studio domain
      exists; changing this default and bumping the kit updates the fleet. */
  href?: string;
  /** The visible anchor text. Default "sk". */
  label?: string;
  /** How schema.org names the creator. Default "sk". */
  organizationName?: string;
  /** Class on the anchor, for the site's own styling. Default "sk-credit". */
  className?: string;
}

const DEFAULT_HREF = "mailto:shaahin69@gmail.com";

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
