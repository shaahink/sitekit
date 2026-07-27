/* The analytics tag.
   ---------------------------------------------------------------------------
   Umami, self-hosted (PLAN §3.7): cookieless, so no consent banner, and one
   instance serves the whole fleet. A site's entire integration is one
   deferred external script tag — this module emits it from one place so the
   instance can move hosts without touching four layouts.

   CSP: the tag is an external script and its beacon posts back to the same
   instance, so both script-src and connect-src must allow umamiOrigin(src).
   That change rides astro.config's CSP directives, in the same commit that
   adds the tag. */

export interface UmamiOptions {
  /** The tracker URL on the stats instance, e.g.
      "https://sk-stats.vercel.app/script.js". */
  src: string;
  /** The site's id in the instance — Settings → Websites → Edit. */
  websiteId: string;
}

/** Attributes for the tracker tag, for spreading onto a script element:
    `<script is:inline {...umamiTag(options)} />` in an Astro layout. */
export function umamiTag(options: UmamiOptions): Record<string, string | boolean> {
  return {
    defer: true,
    src: options.src,
    "data-website-id": options.websiteId
  };
}

/** The same tag as markup, for anything that isn't an Astro component. */
export function umamiScriptTag(options: UmamiOptions): string {
  return `<script defer src="${escapeHtml(options.src)}" data-website-id="${escapeHtml(options.websiteId)}"></script>`;
}

/** The origin both script-src and connect-src must allow. */
export function umamiOrigin(src: string): string {
  return new URL(src).origin;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
