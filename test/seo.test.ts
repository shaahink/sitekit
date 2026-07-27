import { describe, it, expect } from "vitest";
import { absolute, pageUrls, robots, sitemap } from "../src/seo/index.js";

/* The two bilingual sites' routing shapes, as they exist in production. */
const ELFINE = {
  site: "https://elfine-site.vercel.app",
  routing: {
    locales: ["en", "fr"],
    defaultLocale: "en",
    prefixDefaultLocale: false,
    trailingSlash: "always" as const,
    xDefault: true
  }
};

const NIMAGITI = {
  site: "https://nimagiti.vercel.app",
  routing: {
    locales: ["en", "fa"],
    defaultLocale: "en",
    prefixDefaultLocale: true,
    trailingSlash: "never" as const
  }
};

describe("absolute", () => {
  it("resolves a path against the site origin", () => {
    expect(absolute("https://bez-website.vercel.app", "/about.html")).toBe(
      "https://bez-website.vercel.app/about.html"
    );
  });

  it("defaults to the root", () => {
    expect(absolute("https://bez-website.vercel.app")).toBe("https://bez-website.vercel.app/");
  });

  it("accepts a URL object, which is what Astro.site is", () => {
    expect(absolute(new URL("https://elfine-site.vercel.app"), "/assets/img/og-image.jpg")).toBe(
      "https://elfine-site.vercel.app/assets/img/og-image.jpg"
    );
  });
});

describe("pageUrls", () => {
  it("is just the absolute URL on a single-locale site", () => {
    expect(pageUrls({ site: "https://bez-website.vercel.app", path: "/showcase.html" })).toEqual({
      canonical: "https://bez-website.vercel.app/showcase.html",
      alternates: []
    });
  });

  it("keeps elfine's shape: unprefixed default, trailing slashes, x-default", () => {
    expect(pageUrls({ ...ELFINE, locale: "fr" })).toEqual({
      canonical: "https://elfine-site.vercel.app/fr/",
      alternates: [
        { hreflang: "en", href: "https://elfine-site.vercel.app/" },
        { hreflang: "fr", href: "https://elfine-site.vercel.app/fr/" },
        { hreflang: "x-default", href: "https://elfine-site.vercel.app/" }
      ]
    });
  });

  it("keeps nimagiti's shape: both locales prefixed, no slashes, no x-default", () => {
    expect(pageUrls({ ...NIMAGITI, locale: "fa" })).toEqual({
      canonical: "https://nimagiti.vercel.app/fa",
      alternates: [
        { hreflang: "en", href: "https://nimagiti.vercel.app/en" },
        { hreflang: "fa", href: "https://nimagiti.vercel.app/fa" }
      ]
    });
  });

  it("falls back to the default locale for the canonical", () => {
    expect(pageUrls(NIMAGITI).canonical).toBe("https://nimagiti.vercel.app/en");
  });

  it("prefixes deeper paths and still applies the slash policy", () => {
    const { canonical } = pageUrls({ ...ELFINE, path: "/work", locale: "fr" });
    expect(canonical).toBe("https://elfine-site.vercel.app/fr/work/");
  });

  it("leaves .html paths alone regardless of the slash policy", () => {
    const { canonical } = pageUrls({ ...ELFINE, path: "/legal.html", locale: "en" });
    expect(canonical).toBe("https://elfine-site.vercel.app/legal.html");
  });
});

describe("sitemap", () => {
  /* The emitter must reproduce the fleet's hand-written files before it may
     replace them — the header emitter's GOLDEN rule, applied again. These two
     strings are public/sitemap.xml as committed in each repo. */
  const GOLDEN_ELFINE = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://elfine-site.vercel.app/</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://elfine-site.vercel.app/"/>
    <xhtml:link rel="alternate" hreflang="fr" href="https://elfine-site.vercel.app/fr/"/>
  </url>
  <url>
    <loc>https://elfine-site.vercel.app/fr/</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://elfine-site.vercel.app/"/>
    <xhtml:link rel="alternate" hreflang="fr" href="https://elfine-site.vercel.app/fr/"/>
  </url>
</urlset>
`;

  const GOLDEN_NIMAGITI = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://nimagiti.vercel.app/en</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://nimagiti.vercel.app/en"/>
    <xhtml:link rel="alternate" hreflang="fa" href="https://nimagiti.vercel.app/fa"/>
  </url>
  <url>
    <loc>https://nimagiti.vercel.app/fa</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://nimagiti.vercel.app/en"/>
    <xhtml:link rel="alternate" hreflang="fa" href="https://nimagiti.vercel.app/fa"/>
  </url>
</urlset>
`;

  it("reproduces elfine's hand-written sitemap from pageUrls output", () => {
    const routing = { ...ELFINE.routing, xDefault: false };
    const { alternates } = pageUrls({ site: ELFINE.site, routing });
    const entries = alternates.map((a) => ({ loc: a.href, alternates }));
    expect(sitemap(entries)).toBe(GOLDEN_ELFINE);
  });

  it("reproduces nimagiti's hand-written sitemap from pageUrls output", () => {
    const { alternates } = pageUrls(NIMAGITI);
    const entries = alternates.map((a) => ({ loc: a.href, alternates }));
    expect(sitemap(entries)).toBe(GOLDEN_NIMAGITI);
  });

  it("omits the xhtml namespace when nothing uses it", () => {
    const xml = sitemap([
      { loc: "https://bez-website.vercel.app/" },
      { loc: "https://bez-website.vercel.app/about.html" }
    ]);
    expect(xml).not.toContain("xmlns:xhtml");
    expect(xml).toContain("<loc>https://bez-website.vercel.app/about.html</loc>");
  });

  it("escapes what it interpolates", () => {
    const xml = sitemap([{ loc: "https://x.example/?a=1&b=2" }]);
    expect(xml).toContain("<loc>https://x.example/?a=1&amp;b=2</loc>");
  });
});

describe("robots", () => {
  it("reproduces elfine's hand-written robots.txt", () => {
    /* public/robots.txt as committed. */
    expect(
      robots({ sitemap: "https://elfine-site.vercel.app/sitemap.xml", disallow: ["/api/"] })
    ).toBe(`User-agent: *
Allow: /
Disallow: /api/

Sitemap: https://elfine-site.vercel.app/sitemap.xml
`);
  });

  it("drops the Disallow block when there is nothing to hide", () => {
    expect(robots({ sitemap: "https://x.example/sitemap.xml" })).toBe(`User-agent: *
Allow: /

Sitemap: https://x.example/sitemap.xml
`);
  });
});
