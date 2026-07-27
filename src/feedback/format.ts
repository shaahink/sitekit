/* Issue formatting.
   ---------------------------------------------------------------------------
   These issues get read on a phone, weeks later, out of context. Front-load
   the human part; hide the machine part behind a fold. */

import type { LocaleRule } from "./types.js";

/** Formatting context threaded down from the handler's options. */
export interface FormatOptions {
  timeZone: string;
  timestampLocale: string;
  locales: LocaleRule[];
}

export interface BodyInput {
  comment: string;
  name: string;
  page: any;
  target: any;
  client: any;
  shotPath: string | null;
  siteUrl: string;
}

export function buildTitle(comment: string, target: any, page: any): string {
  const where = trimWords(target.section, 40) || pageName(page);
  const excerpt = firstSentence(comment, 64);
  const title = where ? `${where}: ${excerpt}` : excerpt;
  return title || "Feedback";
}

export function buildBody(input: BodyInput, format: FormatOptions): string {
  const { comment, name, page, target, client, shotPath, siteUrl } = input;
  const out: string[] = [];

  out.push(quote(comment));
  out.push("");
  out.push(`<sub>— **${escapeMd(name)}** · ${stamp(format.timeZone, format.timestampLocale)}</sub>`);
  out.push("");

  /* Where on the page */
  const trail: string[] = [];
  if (target.section) trail.push(`**${escapeMd(target.section)}**`);
  if (target.label && target.label !== target.section) trail.push(`“${escapeMd(trim(target.label, 90))}”`);

  const deepLink = siteUrl + (page.path || "/") + (target.sectionId ? `#${target.sectionId}` : "");

  out.push("### Where");
  out.push("");
  out.push(trail.length ? trail.join(" › ") : `The ${pageName(page)} page as a whole`);
  out.push("");
  out.push(`[↗ Open this spot on the site](${deepLink})`);
  out.push("");

  if (shotPath) {
    out.push("### Screenshot");
    out.push("");
    out.push(`<img src="${siteUrl}/api/shot?p=${encodeURIComponent(shotPath)}" width="460" alt="Screenshot sent with this note">`);
    out.push("");
  }

  /* Everything a machine cares about, folded away. */
  /* Only the rows that actually say something — a whole-page note shouldn't
     come with six em-dashes. */
  const rows = [
    ["Page", `${code(page.path || "/")} — ${languageName(page.lang, format.locales)}`],
    ["Section", target.section && `${escapeMd(target.section)}${target.sectionId ? " " + code("#" + target.sectionId) : ""}`],
    ["Element", target.tag && code(target.tag)],
    ["Element text", target.label && escapeMd(trim(target.label, 120))],
    ["Image / link", target.media && code(target.media)],
    ["CSS path", target.selector && code(target.selector)],
    ["Screen", client.viewport && `${client.viewport}${client.dpr > 1 ? ` · ${client.dpr}× density` : ""}`],
    ["Browser", client.ua && describeAgent(client.ua)]
  ].filter(([, value]) => value);

  out.push("<details>");
  out.push("<summary>Page &amp; device details</summary>");
  out.push("");
  out.push("| | |");
  out.push("| --- | --- |");
  rows.forEach(([label, value]) => out.push(`| ${label} | ${cell(value)} |`));
  out.push("");
  if (client.ua) {
    out.push(`Full user agent: ${code(trim(client.ua, 300))}`);
    out.push("");
  }
  out.push("</details>");

  return out.join("\n");
}

export function quote(text: unknown): string {
  return String(text)
    .split(/\r?\n/)
    .map((line) => "> " + (line.trim() ? escapeMd(line) : ""))
    .join("\n");
}

export function pageName(page: any): string {
  const path = page.path || "/";
  if (path === "/" || path === "/index.html") return "Home";
  return path.replace(/^\/|\/$/g, "") || "Home";
}

export function languageName(lang: unknown, locales: LocaleRule[]): string {
  const code = String(lang || "").toLowerCase();
  for (const rule of locales) {
    if (code.startsWith(rule.prefix)) return rule.name;
  }
  return code || "unknown";
}

/* Enough to reproduce a layout bug without pasting a wall of tokens. */
export function describeAgent(ua: string): string {
  if (!ua) return "—";
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\//.test(ua) ? "Opera" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Safari\//.test(ua) ? "Safari" : "Unknown browser";
  const platform =
    /iPhone/.test(ua) ? "iPhone" :
    /iPad/.test(ua) ? "iPad" :
    /Android/.test(ua) ? "Android" :
    /Macintosh/.test(ua) ? "Mac" :
    /Windows/.test(ua) ? "Windows" :
    /Linux/.test(ua) ? "Linux" : "";
  return platform ? `${browser} on ${platform}` : browser;
}

export function stamp(timeZone: string, timestampLocale: string): string {
  try {
    /* Component options rather than dateStyle/timeStyle — the two forms can't
       be mixed, and we want the zone name spelled out. */
    return new Intl.DateTimeFormat(timestampLocale, {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
      timeZoneName: "short"
    }).format(new Date());
  } catch {
    return new Date().toUTCString();
  }
}

export function trim(value: unknown, max: number): string {
  const out = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  return out.length > max ? out.slice(0, max - 1) + "…" : out;
}

export function firstSentence(text: unknown, max: number): string {
  const flat = String(text).replace(/\s+/g, " ").trim();
  const stop = flat.search(/[.!?](\s|$)/);
  const candidate = stop > 12 && stop <= max ? flat.slice(0, stop) : flat;
  return trimWords(candidate, max);
}

/* Titles get read in a list, so never cut mid-word. */
export function trimWords(value: unknown, max: number): string {
  const flat = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:—-]+$/, "") + "…";
}

export function escapeMd(text: unknown): string {
  return String(text).replace(/([_*[\]<>`])/g, "\\$1");
}

export function code(text: unknown): string {
  return "`" + String(text).replace(/`/g, "'") + "`";
}

export function cell(text: unknown): string {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
}
