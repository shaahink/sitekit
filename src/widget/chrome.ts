/* The review widget a reviewer actually sees.
   ---------------------------------------------------------------------------
   The pill, the picker, the composer, the confirmation card, the pins and the
   toast — all of it. Until 0.16.0 this file was `src/scripts/feedback-chrome.js`
   in six site repos: 626 to 658 lines each, at three versions, two of them
   forked to translate a table of twenty-six strings. A change to the widget
   cost six hand edits, two of them re-merged by eye. It now costs a version
   bump, which is the arithmetic PLAN goal 1 asks every kit decision to answer.

   What did *not* move is `feedback-chrome.css`. A reviewer is looking at the
   client's own page and the widget wears the client's palette, so each site
   keeps its stylesheet and the class names it styles are a published contract
   — see `classes.ts`, which a test enforces against this file.

   Nothing here is bundled for the public. Each site's `review-gate.js` reads
   `?review=<key>`, and only for someone who has one does it dynamically import
   this module and that site's stylesheet, so Astro splits both into a chunk
   only reviewers ever fetch. Called rather than bare-imported, for the reason
   `installInlineEditor` is: the kit is `sideEffects: false`, so a bare import
   of a side-effecting module is tree-shaken to nothing and the gate silently
   never runs.

   Talks to:  POST /api/feedback   (createFeedbackHandler, ./feedback)
   Storage:   localStorage["review-mode-key"]  — set by the site's gate
              localStorage["review-mode-name"] — remembered commenter name */

import { context, describe, type ContextOptions, type TargetContext } from "./context.js";
import { shrink, type ShrinkOptions } from "./image.js";
import { refine } from "./pick.js";
import { widgetStrings, fill, type WidgetStrings } from "./strings.js";
import { buildPayload, postFeedback } from "./submit.js";
import { clamp, squash } from "./text.js";

export type { WidgetStrings } from "./strings.js";
export { WIDGET_CLASSES, WIDGET_STATE_CLASSES } from "./classes.js";

/** Where the gate leaves the review key. A site's gate hardcodes this string
    rather than importing it: the gate is the one piece of feedback code every
    public visitor downloads, and it stays a self-contained seventeen lines. */
export const REVIEW_KEY_STORE = "review-mode-key";

/** Where the widget remembers a reviewer's first name between notes. */
export const REVIEW_NAME_STORE = "review-mode-name";

export interface ReviewWidgetOptions {
  /** The feedback edge. Default `/api/feedback`. */
  endpoint?: string;
  /** Overrides for any of the widget's words, applied over the locale table. */
  strings?: Partial<WidgetStrings>;
  /** Force a language instead of reading `<html lang>`. For tests and for the
      rare site whose markup does not declare one. */
  lang?: string;
  /** Landmark and heading selectors for the kit's context extractor. The
      defaults match a `section[id]` + `h2` structure, which is what every site
      in the fleet has; `wholePageLabel` defaults to the locale's own. */
  context?: ContextOptions;
  /** Extra elements the picker must ignore. The widget's own chrome is always
      excluded; this is for a site with a fixed overlay of its own. */
  exclude?: (element: Element) => boolean;
  /** Limits for downscaling a phone photograph before it is sent. */
  image?: ShrinkOptions;
}

interface Point {
  x: number;
  y: number;
}

interface Sheet {
  scrim: HTMLElement;
  box: HTMLElement;
  onViewport?: () => void;
}

/** Build the widget, if this visitor is in review mode.

    Returns false and touches nothing when there is no review key — which is
    every public visitor, and the reason the gate can call this unconditionally
    once it has decided to load the chunk at all. */
export function mountReviewWidget(options: ReviewWidgetOptions = {}): boolean {
  const endpoint = options.endpoint ?? "/api/feedback";
  const stored = read(REVIEW_KEY_STORE);
  if (!stored) return false;
  /* Re-bound rather than used directly: the composer's `submit` is a closure
     several functions deep, and the compiler will not carry the null check
     down there through a hoisted function declaration. */
  const reviewKey: string = stored;

  /* Tidy the URL so a reviewer isn't looking at ?review=... the whole visit.
     The key already lives in localStorage, so navigation and reloads keep
     working. */
  if (/[?&]review=/.test(location.search)) {
    const url = new URL(location.href);
    url.searchParams.delete("review");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  /* ---------- Strings ------------------------------------------------------
     Chosen from <html lang>, so a bilingual site's reviewer gets the language
     of the page they are on, and a site's own overrides sit on top. */

  const T: WidgetStrings = widgetStrings(options.lang ?? document.documentElement.lang, options.strings);

  /* How the kit's pickers see this site: ignore our own chrome, and label
     whole-page notes in the reviewer's language. */
  const extra = options.exclude;
  const PICK_OPTS = { exclude: (node: Element) => isOurs(node) || (extra ? extra(node) : false) };
  const CTX_OPTS: ContextOptions = { wholePageLabel: T.wholePageLabel, ...options.context };

  /* ---------- Boot ---------------------------------------------------------- */

  let root: HTMLElement;
  let bar: HTMLElement;
  let barLabel: HTMLElement;
  let barBadge: HTMLElement;
  let pinLayer: HTMLElement;
  let menu: HTMLElement | null = null;
  let highlight: HTMLElement | null = null;
  let highlightTag: HTMLElement | null = null;
  let toastEl: HTMLElement | null = null;
  let picking = false;
  let sheet: Sheet | null = null;
  const sent: string[] = [];

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
  return true;

  function build(): void {
    root = el("div", "rv-root");
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", T.regionLabel);

    pinLayer = el("div", "rv-pins");
    root.appendChild(pinLayer);

    bar = el("div", "rv-bar");
    const main = el("button", "rv-main");
    main.appendChild(el("span", "rv-dot"));
    barLabel = el("span");
    barLabel.textContent = T.comment;
    main.appendChild(barLabel);
    barBadge = el("span", "rv-badge");
    barBadge.style.display = "none";
    main.appendChild(barBadge);
    main.addEventListener("click", () => {
      closeMenu();
      picking ? stopPicking() : startPicking();
    });

    const more = el("button", "rv-more");
    more.textContent = "▾";
    more.setAttribute("aria-label", T.more);
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      menu ? closeMenu() : openMenu();
    });

    bar.appendChild(main);
    bar.appendChild(more);
    root.appendChild(bar);
    document.body.appendChild(root);

    toast(T.intro, 3600);
  }

  /* ---------- Menu ---------------------------------------------------------- */

  function openMenu(): void {
    menu = el("div", "rv-menu");

    if (sent.length) {
      const count = el("div", "rv-count");
      count.textContent = sent.length === 1
        ? T.countOne
        : fill(T.countMany, { n: sent.length });
      menu.appendChild(count);
    }

    menu.appendChild(menuItem(T.wholePage, () => {
      closeMenu();
      openComposer(null, null);
    }));
    menu.appendChild(menuItem(T.exit, () => {
      closeMenu();
      remove(REVIEW_KEY_STORE);
      location.reload();
    }));

    root.appendChild(menu);
    setTimeout(() => { document.addEventListener("click", closeMenu, { once: true }); }, 0);
  }

  function menuItem(label: string, onClick: () => void): HTMLElement {
    const b = el("button");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function closeMenu(): void {
    if (menu) { menu.remove(); menu = null; }
  }

  /* ---------- Picking an element -------------------------------------------
     Capture-phase listeners so a tap on a link opens the composer instead of
     navigating. Everything inside .rv-root is ignored. */

  function startPicking(): void {
    picking = true;
    bar.classList.add("is-picking");
    barLabel.textContent = T.picking;
    document.documentElement.classList.add("rv-picking");

    highlight = el("div", "rv-hl");
    highlightTag = el("div", "rv-hl-tag");
    highlight.appendChild(highlightTag);
    highlight.style.display = "none";
    root.appendChild(highlight);

    document.addEventListener("pointermove", onHover, true);
    document.addEventListener("click", onPick, true);
    document.addEventListener("keydown", onEscape, true);
  }

  function stopPicking(): void {
    picking = false;
    bar.classList.remove("is-picking");
    barLabel.textContent = T.comment;
    document.documentElement.classList.remove("rv-picking");
    if (highlight) { highlight.remove(); highlight = null; highlightTag = null; }

    document.removeEventListener("pointermove", onHover, true);
    document.removeEventListener("click", onPick, true);
    document.removeEventListener("keydown", onEscape, true);
  }

  function onEscape(e: KeyboardEvent): void {
    if (e.key === "Escape") { e.preventDefault(); stopPicking(); }
  }

  function onHover(e: PointerEvent): void {
    if (!highlight) return;
    const target = refine(e.target, PICK_OPTS);
    if (!target) { highlight.style.display = "none"; return; }
    drawHighlight(target);
  }

  function onPick(e: MouseEvent): void {
    if (e.target instanceof Element && isOurs(e.target)) return;
    e.preventDefault();
    e.stopPropagation();

    const target = refine(e.target, PICK_OPTS);
    if (!target) return;

    const point: Point = { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
    stopPicking();
    openComposer(target, point);
  }

  function isOurs(node: Element | null): boolean {
    return !!(node && node.closest && node.closest(".rv-root"));
  }

  function drawHighlight(target: Element): void {
    if (!highlight || !highlightTag) return;
    const rect = target.getBoundingClientRect();
    highlight.style.display = "block";
    highlight.style.left = rect.left + "px";
    highlight.style.top = rect.top + "px";
    highlight.style.width = rect.width + "px";
    highlight.style.height = rect.height + "px";
    highlightTag.textContent = describe(target, CTX_OPTS);
  }

  /* ---------- Composer ------------------------------------------------------ */

  function openComposer(picked: Element | null, point: Point | null): void {
    closeComposer();

    let target = picked;
    let ctx: TargetContext = context(target, CTX_OPTS);
    let image: string | null = null;

    const scrim = el("div", "rv-scrim");
    scrim.addEventListener("click", closeComposer);

    const box = el("div", "rv-sheet");
    box.addEventListener("click", (e) => { e.stopPropagation(); });

    /* Context strip — what you're commenting on, plus a way to widen it. */
    const ctxRow = el("div", "rv-ctx");
    const ctxText = el("div", "rv-ctx-text");
    ctxRow.appendChild(ctxText);

    if (target) {
      const upBtn = el("button", "rv-up");
      upBtn.textContent = "⤴";
      upBtn.title = T.broaden;
      upBtn.setAttribute("aria-label", T.broaden);
      upBtn.addEventListener("click", () => {
        const parent = target?.parentElement;
        if (!parent || parent === document.body) return;
        target = parent;
        ctx = context(target, CTX_OPTS);
        paintCtx();
        flash(target);
      });
      ctxRow.appendChild(upBtn);
    }

    function paintCtx(): void {
      ctxText.innerHTML = "";
      /* Picking a section heading makes section and label the same string —
         show it once rather than "Works › Works". */
      const label = squash(ctx.label, 60);
      const showLabel = label && label !== squash(ctx.section, 60);

      if (ctx.section) {
        const lead = el("span");
        lead.textContent = ctx.section + (showLabel ? " › " : "");
        ctxText.appendChild(lead);
      }
      if (showLabel || (!ctx.section && label)) {
        const strong = el("b");
        strong.textContent = label;
        ctxText.appendChild(strong);
      }
      if (!ctx.section && !label) ctxText.textContent = ctx.tag || T.wholePageLabel;
    }
    paintCtx();
    box.appendChild(ctxRow);

    /* Fields */
    const body = el("div", "rv-body");

    const textarea = document.createElement("textarea");
    textarea.placeholder = T.placeholder;
    textarea.maxLength = 5000;
    body.appendChild(textarea);

    const attachRow = el("div", "rv-attach");
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";

    const attachBtn = el("button", "rv-attach-btn");
    attachBtn.type = "button";
    attachBtn.textContent = "📷 " + T.photo;
    attachBtn.addEventListener("click", () => { fileInput.click(); });

    const hint = el("span");
    hint.textContent = T.photoHint;

    const thumbWrap = el("span", "rv-thumb");
    thumbWrap.style.display = "none";
    const thumbImg = document.createElement("img");
    const thumbX = el("button");
    thumbX.textContent = "×";
    thumbX.title = T.remove;
    thumbX.setAttribute("aria-label", T.remove);
    thumbX.addEventListener("click", clearImage);
    thumbWrap.appendChild(thumbImg);
    thumbWrap.appendChild(thumbX);

    attachRow.appendChild(attachBtn);
    attachRow.appendChild(thumbWrap);
    attachRow.appendChild(hint);
    attachRow.appendChild(fileInput);
    body.appendChild(attachRow);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = T.namePlaceholder;
    nameInput.maxLength = 60;
    nameInput.value = read(REVIEW_NAME_STORE) || "";
    if (!nameInput.value) body.appendChild(nameInput);

    /* Honeypot — invisible to people, tempting to bots. */
    const trap = document.createElement("input");
    trap.type = "text";
    trap.name = "website";
    trap.tabIndex = -1;
    trap.setAttribute("aria-hidden", "true");
    trap.autocomplete = "off";
    trap.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;opacity:0";
    body.appendChild(trap);

    box.appendChild(body);

    const foot = el("div", "rv-foot");
    const cancel = el("button", "rv-ghost");
    cancel.textContent = T.cancel;
    cancel.addEventListener("click", closeComposer);
    const msg = el("span", "rv-msg");
    const send = el("button", "rv-send");
    send.textContent = T.send;
    send.addEventListener("click", submit);
    foot.appendChild(cancel);
    foot.appendChild(msg);
    foot.appendChild(send);
    box.appendChild(foot);

    root.appendChild(scrim);
    root.appendChild(box);
    sheet = { scrim, box };

    position(box, point);
    setTimeout(() => { textarea.focus(); }, 30);

    /* Keep the sheet above the on-screen keyboard on phones. */
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", onViewport);
      sheet.onViewport = onViewport;
    }
    function onViewport(): void {
      const vv = window.visualViewport;
      if (!vv || window.innerWidth > 640) return;
      box.style.transform = "translateY(-" + Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + "px)";
    }

    /* Paste a screenshot straight in — the fastest path on a laptop. */
    box.addEventListener("paste", (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item && item.type && item.type.indexOf("image/") === 0) {
          e.preventDefault();
          loadImage(item.getAsFile());
          return;
        }
      }
    });

    for (const name of ["dragenter", "dragover"] as const) {
      box.addEventListener(name, (e) => { e.preventDefault(); box.classList.add("rv-drop"); });
    }
    for (const name of ["dragleave", "drop"] as const) {
      box.addEventListener(name, (e) => { e.preventDefault(); box.classList.remove("rv-drop"); });
    }
    box.addEventListener("drop", (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file) loadImage(file);
    });

    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) loadImage(file);
    });

    function loadImage(file: File | null): void {
      if (!file || file.type.indexOf("image/") !== 0) return;
      note("");
      shrink(file, options.image ?? {}).then((dataUrl) => {
        image = dataUrl;
        thumbImg.src = dataUrl;
        thumbWrap.style.display = "";
        attachBtn.style.display = "none";
        hint.style.display = "none";
      }).catch((error) => {
        note(error && error.message === "too big" ? T.tooBig : T.badImage);
      });
    }

    function clearImage(): void {
      image = null;
      fileInput.value = "";
      thumbWrap.style.display = "none";
      attachBtn.style.display = "";
      hint.style.display = "";
    }

    function note(text: string): void { msg.textContent = text || ""; }

    function submit(): void {
      const comment = textarea.value.trim();
      if (!comment) { note(T.empty); textarea.focus(); return; }

      const name = nameInput.value.trim();
      if (name) write(REVIEW_NAME_STORE, name);

      send.disabled = true;
      send.textContent = T.sending;
      note("");

      const payload = buildPayload({
        key: reviewKey,
        website: trap.value,
        comment,
        name: name || read(REVIEW_NAME_STORE) || "",
        image,
        target: ctx
      });

      postFeedback(endpoint, payload).then(() => {
        sent.push(comment);
        if (point) dropPin(point, sent.length, comment);
        bumpBadge();
        buzz();
        showSuccess(comment);
      }).catch((error) => {
        send.disabled = false;
        send.textContent = T.send;
        note(T.failed + " " + (error.message || ""));
        offerCopy(foot, comment, ctx);
      });
    }

    /* Swap the whole sheet for a confirmation. A toast alone is too easy to
       miss on a phone, and "did that send?" is the one question this tool
       must never leave open. */
    function showSuccess(comment: string): void {
      ctxRow.remove();
      body.remove();
      foot.remove();

      const done = el("div", "rv-done");
      const check = el("div", "rv-check");
      check.innerHTML = '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M6 14.5l5.5 5.5L22 8.5"/></svg>';
      done.appendChild(check);

      const title = el("h3");
      title.textContent = T.sentTitle;
      done.appendChild(title);

      const blurb = el("p");
      blurb.textContent = T.sentBody;
      done.appendChild(blurb);

      const quote = el("div", "rv-done-quote");
      quote.textContent = "“" + squash(comment, 130) + "”";
      done.appendChild(quote);

      done.appendChild(el("div", "rv-done-bar"));

      box.setAttribute("role", "status");
      box.setAttribute("aria-live", "polite");
      box.appendChild(done);
      position(box, point);

      setTimeout(() => {
        closeComposer();
        toast(T.sent, 2600);
      }, 2000);
    }
  }

  function bumpBadge(): void {
    barBadge.textContent = String(sent.length);
    barBadge.style.display = "";
    barBadge.classList.remove("is-new");
    void barBadge.offsetWidth;
    barBadge.classList.add("is-new");
  }

  function buzz(): void {
    try { if (navigator.vibrate) navigator.vibrate(18); } catch { /* unsupported */ }
  }

  function closeComposer(): void {
    if (!sheet) return;
    if (sheet.onViewport && window.visualViewport) {
      window.visualViewport.removeEventListener("resize", sheet.onViewport);
    }
    sheet.scrim.remove();
    sheet.box.remove();
    sheet = null;
  }

  /* Desktop: anchor the card near the click, clamped inside the viewport.
     Phones get the bottom-sheet layout from CSS, so skip it. The coordinates
     are viewport geometry — physical left/top is correct in both directions,
     which is why this is the one place the kit's logical-CSS rule does not
     apply (nimagiti's widget runs under dir="rtl"). */
  function position(box: HTMLElement, point: Point | null): void {
    if (window.innerWidth <= 640) return;
    const width = Math.min(380, window.innerWidth - 32);
    const height = box.offsetHeight || 300;
    const x = point ? point.x - window.scrollX + 16 : window.innerWidth / 2 - width / 2;
    const y = point ? point.y - window.scrollY + 16 : window.innerHeight / 2 - height / 2;
    box.style.left = clamp(x, 16, window.innerWidth - width - 16) + "px";
    box.style.top = clamp(y, 16, Math.max(16, window.innerHeight - height - 16)) + "px";
  }

  /* If the network is down, never swallow what was written. */
  function offerCopy(foot: HTMLElement, comment: string, ctx: TargetContext): void {
    if (foot.querySelector(".rv-copy")) return;
    const copy = el("button", "rv-ghost rv-copy");
    copy.textContent = T.copy;
    copy.addEventListener("click", () => {
      const text = comment + "\n\n— " + (ctx.section || "") + " " + (ctx.label || "") + "\n" + location.href;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => {
        copy.textContent = T.copied;
      }).catch(() => {
        window.prompt(T.copy, text);
      });
    });
    foot.insertBefore(copy, foot.firstChild);
  }

  /* ---------- Pins ---------------------------------------------------------- */

  function dropPin(point: Point, index: number, comment: string): void {
    const pin = el("div", "rv-pin");
    pin.textContent = String(index);
    pin.title = comment;
    pin.style.left = point.x + "px";
    pin.style.top = point.y + "px";
    /* Pins sit in document space, so track the page as it scrolls. */
    pinLayer.style.position = "fixed";
    pin.style.position = "fixed";
    reposition();
    window.addEventListener("scroll", reposition, { passive: true });
    function reposition(): void {
      pin.style.left = (point.x - window.scrollX) + "px";
      pin.style.top = (point.y - window.scrollY) + "px";
    }
    pinLayer.appendChild(pin);
  }

  function flash(target: Element): void {
    const rect = target.getBoundingClientRect();
    const box = el("div", "rv-hl");
    box.style.left = rect.left + "px";
    box.style.top = rect.top + "px";
    box.style.width = rect.width + "px";
    box.style.height = rect.height + "px";
    root.appendChild(box);
    setTimeout(() => { box.remove(); }, 550);
  }

  /* ---------- Toast --------------------------------------------------------- */

  function toast(text: string, ms?: number): void {
    if (toastEl) toastEl.remove();
    toastEl = el("div", "rv-toast");
    toastEl.textContent = text;
    root.appendChild(toastEl);
    const mine = toastEl;
    setTimeout(() => { if (mine === toastEl) { mine.remove(); toastEl = null; } }, ms || 3000);
  }
}

/* ---------- Small helpers --------------------------------------------------- */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

function remove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* private mode */ }
}
