import { describe, it, expect } from "vitest";
import { credits, creditsAnchor, creditsJsonLd } from "../src/credits/index.js";

const ELFINE = { siteName: "Elfine", siteUrl: "https://elfine-site.vercel.app" };

describe("creditsAnchor", () => {
  it("emits the sk line with class hook and author rel", () => {
    expect(creditsAnchor(ELFINE)).toBe(
      '<a class="sk-credit" href="mailto:shaahin69@gmail.com" rel="author">sk</a>'
    );
  });

  it("escapes what it interpolates", () => {
    const html = creditsAnchor({ ...ELFINE, label: "<sk>", href: 'x"y' });
    expect(html).toContain("&lt;sk&gt;");
    expect(html).toContain('href="x&quot;y"');
  });
});

describe("creditsJsonLd", () => {
  it("claims creatorship in valid schema.org JSON-LD", () => {
    const html = creditsJsonLd(ELFINE);
    const match = html.match(/^<script type="application\/ld\+json">(.*)<\/script>$/s);
    expect(match).not.toBeNull();
    const data = JSON.parse(match![1]!);
    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Elfine",
      url: "https://elfine-site.vercel.app",
      creator: {
        "@type": "Organization",
        name: "sk",
        url: "mailto:shaahin69@gmail.com"
      }
    });
  });

  it("cannot be broken out of with a closing script tag", () => {
    const html = creditsJsonLd({ ...ELFINE, siteName: "</script><script>alert(1)" });
    expect(html.match(/<\/script>/g)!.length).toBe(1);
  });
});

describe("credits", () => {
  it("bundles anchor and JSON-LD for the footer", () => {
    const html = credits(ELFINE);
    expect(html).toContain('class="sk-credit"');
    expect(html).toContain('type="application/ld+json"');
  });
});
