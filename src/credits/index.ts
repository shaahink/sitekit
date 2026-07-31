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

/* The credit line — one sentence, English, on every page of every site.
   ---------------------------------------------------------------------------
   Until 0.23.0 the kit handed back a bare anchor and each site wrapped it in
   its own words, which produced four different credits across five sites:
   behrooz said "Created by sk", shade put it after a copyright symbol,
   nimagiti and mosleh showed the bare name. Nobody decided that; it accreted.
   So the whole phrase moved here and the sites stopped owning any of it.

   0.23.0 translated it — French on elfine, Farsi on nimagiti's `/fa` and on
   all 21 of mosleh's pages. **0.24.0 stops.** This line is not the site's
   speech, it is the studio's signature, and a signature is the one string on
   a page that does not belong to the reader's language: it names sk, it points
   at sk's own site, and that site is in English whichever footer sent somebody
   to it. Three spellings of one studio's name also made the credit read as
   part of the client's copy rather than as an attribution under it.

   `{sk}` stays a placeholder rather than becoming a suffix, even though
   English puts the name at the start. It is what makes the sentence one
   editable string instead of a concatenation, and the day the wording changes
   again the change is inside these quotes and nowhere else. */
const CREDIT_LINE = "{sk} made this";

export interface CreditLineOptions extends CreditsOptions {
  /** The page's language — **accepted and ignored since 0.24.0.**

      Kept on the interface rather than deleted, because the type is what six
      site repos compile against: `creditsFor({ …, lang: "fa" })` is written
      into mosleh's footer on `main` today, and removing the property would
      turn a footer change into a build break in every repo that had not been
      edited yet. A site may stop passing it whenever it likes. */
  lang?: string;
}

/** The visible credit, whole: `sk made this`, with `sk` as the link.
    Presentation still belongs to the site — this returns a `<span>` with a
    class hook and no styling of its own.

    `lang="en" dir="ltr"`, stated on the span, because since 0.24.0 this is an
    English sentence that lands on Farsi and French pages too. The Latin run
    would lay itself out left-to-right regardless — the declaration is for the
    reader a browser cannot see: a screen reader announcing a Persian page
    should switch voice for these three words rather than spell them out, and
    `dir` keeps the sentence intact if the label it is built around ever stops
    being pure Latin. */
export function creditLine(options: CreditLineOptions): string {
  const anchor = creditsAnchor(options);
  return (
    `<span class="sk-creditline" lang="en" dir="ltr">` +
    `${CREDIT_LINE.replace("{sk}", anchor)}</span>`
  );
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
