/* Reading context off the page.
   ---------------------------------------------------------------------------
   Which section is this, what does the element say, what would you call it —
   the answers end up in the issue title and the details table. */

import { squash, basename } from "./text.js";
import { selectorFor } from "./pick.js";

export interface LandmarkOptions {
  /** The landmark the picker prefers — an element that names a region of the
      page. Preferring `section[id]` over a bare `header` matters on sites
      whose cards wrap their titles in an inner <header>: matching that would
      label everything with its own title. */
  landmark?: string;
  /** Tried when nothing matches `landmark`. */
  landmarkFallback?: string;
  /** Where a landmark's name comes from, tried in order. */
  headings?: string;
  headingsFallback?: string;
}

export interface ContextOptions extends LandmarkOptions {
  /** The label reported when a note is about the page as a whole. The string
      is the site's to choose — it is user-facing and localized there. */
  wholePageLabel?: string;
}

export interface SectionInfo {
  name: string;
  id: string;
}

/** What the widget sends about the picked element. */
export interface TargetContext {
  label: string;
  selector: string;
  section: string;
  sectionId: string;
  tag: string;
  media: string;
}

const LANDMARK = "section[id]";
const LANDMARK_FALLBACK = "section, article, footer, nav, main";
const HEADINGS = "h1, h2";
const HEADINGS_FALLBACK = "h3";

/* The nearest landmark with a name. */
export function sectionInfo(target: Element, options: LandmarkOptions = {}): SectionInfo {
  const section =
    target.closest(options.landmark || LANDMARK) ||
    target.closest(options.landmarkFallback || LANDMARK_FALLBACK);
  if (!section) return { name: "", id: "" };
  const heading =
    section.querySelector(options.headings || HEADINGS) ||
    section.querySelector(options.headingsFallback || HEADINGS_FALLBACK);
  return {
    name: heading
      ? squash(heading.textContent, 90)
      : squash(section.getAttribute("aria-label") || "", 90),
    id: section.id || ""
  };
}

/** The element's own words: its text, or an image's alt/filename. */
export function ownText(target: Element): string {
  if (target.tagName === "IMG") {
    const img = target as HTMLImageElement;
    return img.alt || basename(img.currentSrc || img.src);
  }
  const img = target.querySelector && target.querySelector("img");
  const text = squash(target.textContent || "", 90);
  if (!text && img) return img.alt || basename(img.currentSrc || img.src);
  return text;
}

/** A short human label for the highlight tag: "Section › element text". */
export function describe(target: Element, options: LandmarkOptions = {}): string {
  const info = sectionInfo(target, options);
  const own = squash(ownText(target), 40);
  const parts: string[] = [];
  if (info.name) parts.push(squash(info.name, 40));
  if (own && own !== squash(info.name, 40)) parts.push(own);
  return parts.join(" › ") || target.tagName.toLowerCase();
}

/** Everything the handler wants to know about the picked element.
    Pass `null` for a whole-page note. */
export function context(target: Element | null, options: ContextOptions = {}): TargetContext {
  if (!target) {
    return {
      label: options.wholePageLabel || "",
      selector: "",
      section: "",
      sectionId: "",
      tag: "",
      media: ""
    };
  }
  const info = sectionInfo(target, options);
  const img = target.tagName === "IMG"
    ? (target as HTMLImageElement)
    : (target.querySelector && target.querySelector("img"));
  const link = target.tagName === "A" ? target : target.closest("a[href]");

  return {
    label: squash(ownText(target), 160),
    selector: selectorFor(target),
    section: info.name,
    sectionId: info.id,
    tag: target.tagName.toLowerCase() + (target.className && typeof target.className === "string"
      ? "." + target.className.trim().split(/\s+/).slice(0, 2).join(".")
      : ""),
    media: img ? basename(img.currentSrc || img.src) : (link ? link.getAttribute("href") || "" : "")
  };
}
