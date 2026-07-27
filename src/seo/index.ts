/* Site URLs from one source.
   ---------------------------------------------------------------------------
   Every absolute URL a site publishes about itself — canonical, hreflang
   alternates, og:url, the sitemap, robots.txt — derived from the one `site`
   value astro.config already holds, so a domain change is a one-line commit
   (PLAN §3.8). The fleet had three competing mechanisms for this fact and
   fifteen hardcoded copies per bilingual site; this module is their
   replacement, not their fourth sibling.

   Locale routing differs per site by design — elfine serves an unprefixed
   default with trailing slashes and an x-default, nimagiti prefixes both
   locales and strips slashes — so the routing shape is an option, never an
   assumption. */

export interface LocaleRouting {
  locales: string[];
  defaultLocale: string;
  /** Mirror of Astro i18n's prefixDefaultLocale. Default false. */
  prefixDefaultLocale?: boolean;
  /** "always" → "/fr/", "never" → "/fa". Paths whose last segment carries an
      extension are left alone either way. Default "never". */
  trailingSlash?: "always" | "never";
  /** Emit an x-default alternate pointing at the default locale. */
  xDefault?: boolean;
}

export interface PageUrlOptions {
  /** The site origin — astro.config's `site`, i.e. Astro.site. */
  site: string | URL;
  /** The page's path without any locale prefix. Default "/". */
  path?: string;
  /** The locale this page renders in; picks the canonical. Omit on
      single-locale sites. */
  locale?: string;
  routing?: LocaleRouting;
}

export interface Alternate {
  hreflang: string;
  href: string;
}

export interface PageUrls {
  canonical: string;
  /** One entry per locale, plus x-default when asked for — the exact set a
      layout renders as <link rel="alternate"> and a sitemap entry embeds. */
  alternates: Alternate[];
}

/** A path resolved against the site origin — the absolute form scrapers
    require for canonical and og:image, which relative hrefs quietly fail. */
export function absolute(site: string | URL, path: string = "/"): string {
  return new URL(path, site).href;
}

/** The canonical and alternate URLs for one page. */
export function pageUrls(options: PageUrlOptions): PageUrls {
  const { site, path = "/", locale, routing } = options;
  if (!routing) return { canonical: absolute(site, path), alternates: [] };

  const hrefFor = (l: string) => absolute(site, localePath(path, l, routing));
  const alternates: Alternate[] = routing.locales.map((l) => ({ hreflang: l, href: hrefFor(l) }));
  if (routing.xDefault) {
    alternates.push({ hreflang: "x-default", href: hrefFor(routing.defaultLocale) });
  }
  return { canonical: hrefFor(locale ?? routing.defaultLocale), alternates };
}

export interface SitemapEntry {
  loc: string;
  alternates?: Alternate[];
}

/** The complete sitemap.xml text, trailing newline included — the shape the
    fleet's hand-written files already had, which this emitter reproduces
    before it may replace them. The xhtml namespace appears only when an
    entry actually carries alternates. */
export function sitemap(entries: SitemapEntry[]): string {
  const withAlternates = entries.some((e) => e.alternates && e.alternates.length);
  const open = withAlternates
    ? '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
      '        xmlns:xhtml="http://www.w3.org/1999/xhtml">'
    : '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

  const body = entries
    .map((entry) => {
      const lines = ["  <url>", `    <loc>${escapeXml(entry.loc)}</loc>`];
      for (const a of entry.alternates ?? []) {
        lines.push(
          `    <xhtml:link rel="alternate" hreflang="${escapeXml(a.hreflang)}" href="${escapeXml(a.href)}"/>`
        );
      }
      lines.push("  </url>");
      return lines.join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n${open}\n${body}\n</urlset>\n`;
}

export interface RobotsOptions {
  /** The sitemap's absolute URL — absolute(site, "/sitemap.xml"). */
  sitemap: string;
  /** Paths crawlers must skip; the fleet passes ["/api/"]. */
  disallow?: string[];
}

/** The complete robots.txt text, trailing newline included. */
export function robots(options: RobotsOptions): string {
  const lines = ["User-agent: *", "Allow: /"];
  for (const path of options.disallow ?? []) lines.push(`Disallow: ${path}`);
  return lines.join("\n") + `\n\nSitemap: ${options.sitemap}\n`;
}

/* "/fa" or "/fr/work" — the locale prefix applied (or not, for an unprefixed
   default), then the site's trailing-slash policy. */
function localePath(path: string, locale: string, routing: LocaleRouting): string {
  const prefixed = routing.prefixDefaultLocale || locale !== routing.defaultLocale;
  const base = prefixed ? `/${locale}${path === "/" ? "" : path}` : path;
  return applyTrailing(base, routing.trailingSlash ?? "never");
}

function applyTrailing(path: string, policy: "always" | "never"): string {
  const lastSegment = path.slice(path.lastIndexOf("/") + 1);
  if (lastSegment.includes(".")) return path;
  if (policy === "always") return path.endsWith("/") ? path : path + "/";
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
