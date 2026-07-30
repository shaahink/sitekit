/* Editing the words on the page they are on.
   ---------------------------------------------------------------------------
   The panel at /edit reaches every field, including the ones with no visible
   DOM at all — meta descriptions, alt text, aria labels. This reaches the ones
   an owner can point at, which is most of what they actually want to change,
   and it does it without them having to work out which form field corresponds
   to the sentence they are looking at.

   Two surfaces, one truth. This shares `Dirty` and the same POST to
   /api/content with the panel; the moment they diverge, one starts overwriting
   the other's edits. Nothing here validates, decides who may edit, or knows
   what a schema is — the server re-reads the file, re-applies the edits and
   re-validates the whole document, exactly as it does for the panel. An
   attacker who adds ?edit=1 gets a user interface that 401s.

   It never loads Google. Sign-in stays at /edit; this layer only ever uses a
   session that already exists, which is what keeps `connect-src 'self'` and
   `script-src 'self'` sufficient on public pages.

   The per-site cost is the annotations: `data-sk-edit="hero.tagline"` on the
   element already holding {hero.tagline}, and the collection and entry on the
   body. That is real work and PLAN §3.9 accepts it. What it is not is
   *recurring* work — everything below is in the kit and arrives by version
   bump. */

import type { Field } from "../cms/fields.js";
import { Dirty } from "./dirty.js";
import { clearDraft, draftKey, readDraft, saveDraft, type Draft } from "./drafts.js";
import { Bar, type SaveState } from "./inline-bar.js";
import { EDIT_PARAM, panelHref, signInHref, TOUR_PARAM, tourArmed } from "./return-to.js";
import { digitsFor, dirFor, editorStrings, fill, type EditorStrings } from "./strings.js";
import { Tour, tourStorage, type TourStep } from "./tour.js";
import { coerce, findField, plural, valueAt } from "./values.js";

export interface InlineOptions {
  /** The content edge. Default `/api/content`. */
  contentPath?: string;
  /** Where the full panel lives — `/edit` or `/edit.html`, depending on the
      site's `build.format`. Read from `data-sk-editor-path` when present. */
  editorPath?: string;
  /** The stylesheet the site copied into public/. Default
      `/editor-inline.css`. */
  cssHref?: string;
  strings?: Partial<EditorStrings>;
  /** Force the bar's language. Left alone it follows `<html lang>`, which is
      the language of the page the owner is looking at — right by construction
      on a bilingual site, where the same layout installs the bar on both
      halves. */
  lang?: string;
}

interface Editable {
  element: HTMLElement;
  path: string;
  field: Field;
  /** What the file says today. Updated on every successful save, so a second
      edit in the same session compares against the right thing. */
  original: string;
  /** Whether this layer added `dir="auto"`, so leaving edit mode can put the
      element back exactly as the site rendered it. */
  addedDir: boolean;
}

/** What an annotated element turned out to be. Everything except `edit` is a
    dead end for this surface, and each one says why on the element itself —
    an owner tapping something that will never save is the failure this whole
    layer has to avoid. */
type Verdict =
  | { kind: "edit"; field: Field; value: string }
  /* `why` picks which sentence the owner is shown. "formatting" is true of a
     value carrying markup and of an element wrapping the design's own spans;
     "elsewhere" covers everything that is not about formatting at all, where
     saying so would be a lie they could act on. */
  | { kind: "panel"; why: "formatting" | "elsewhere"; reason: string; label: string }
  | { kind: "broken"; reason: string };

/** Contexts whose contents are not spoken, so nothing inside may become a
    focusable textbox. */
const UNSPOKEN = '[aria-hidden="true"], [role="img"]';

/** Contexts where a tap already means something else.
    -------------------------------------------------------------------------
    A real `<button>` and anything wearing a widget role, because the role is
    the site telling us a click here runs its code. It is not pedantry: the
    handler is usually delegated from the document, so `preventDefault` on the
    element does not stop it, and a site that makes a div keyboard-operable
    generally maps Space to a click — which means the owner cannot type a space
    into the text they are editing. Bruce's showcase captions live inside
    `role="button"` gallery cells that open the lightbox exactly that way. */
const INTERACTIVE = [
  "button",
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]'
].join(", ");

export async function startInlineEditor(options: InlineOptions = {}): Promise<void> {
  /* The page the owner is standing on is the one thing that always knows which
     language they are editing in — the same source `widget/chrome.ts` reads,
     and for the same reason. */
  const lang = options.lang ?? document.documentElement.lang;
  const strings: EditorStrings = editorStrings(lang, options.strings);
  /* Persian counts are Persian digits. Resolved once here rather than at every
      call site, because the bar asks on every keystroke. */
  const digits = digitsFor(lang);
  const contentPath = options.contentPath ?? "/api/content";
  const cssHref = options.cssHref ?? "/editor-inline.css";

  const scope = document.querySelector<HTMLElement>("[data-sk-collection]");
  const collection = scope?.dataset.skCollection;
  if (!collection) return;
  const entry = scope?.dataset.skEntry ?? "";
  const editorPath = options.editorPath ?? scope?.dataset.skEditorPath ?? "/edit";

  const annotated = [...document.querySelectorAll<HTMLElement>("[data-sk-edit]")];

  const dirty = new Dirty();
  const editables = new Map<string, Editable>();
  /* Every listener this layer adds hangs off one signal, so leaving edit mode
     removes all of them at once. It matters more than it looks: the click
     suppressor on editable text inside a link would otherwise outlive edit
     mode and leave the link dead until a reload. */
  const listeners = new AbortController();
  const on = { signal: listeners.signal } as const;
  const key = draftKey(collection, entry);
  let sha = "";
  let saving = false;
  /* "Saved — see the change" is true until the moment it isn't. Left showing
     next to "1 change not saved yet" it reads as a contradiction, so the first
     keystroke after a save takes it down. Only that note: a draft offer or an
     error is still relevant while someone types. */
  let noteIsStaleOnEdit = false;

  /** This page, as a path the panel can hand back to `editHref` — without the
      `edit=1` that put us in edit mode, because `editHref` puts it back and
      `?edit=1&edit=1` is not a URL an owner could have arrived at by hand.
      Everything else the page was carrying stays: `?review=` is how a site
      shows a draft, and coming back to the published page instead would be a
      different page. The hash goes too — an owner two thirds down a long page
      should come back to the paragraph they were reading. */
  function herePath(): string {
    const url = new URL(location.href);
    url.searchParams.delete(EDIT_PARAM);
    /* And the arming, for the same reason twice over: a Home link carrying
       `tour=1` would arm the tour again on the way back, and the panel would put
       an already-armed page behind its own "Show me how". */
    url.searchParams.delete(TOUR_PARAM);
    const query = url.searchParams.toString();
    return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
  }

  /* Read before anything else touches the URL, and spent immediately. Left on
     the address bar it would survive a reload, and "dismissed stays dismissed
     across reloads" would then be true of the flag and false of what an owner
     actually meets — the one thing §2.5 inherits from 7.7 that a test can check
     and a person would notice. */
  const armed = tourArmed(location.search);
  if (armed) {
    const url = new URL(location.href);
    url.searchParams.delete(TOUR_PARAM);
    history.replaceState(null, "", url);
  }

  const bar = new Bar(cssHref, {
    regionLabel: strings.inlineHelpTitle,
    save: strings.save,
    revert: strings.inlineRevert,
    discard: strings.inlineDiscard,
    help: strings.inlineHelp,
    helpTitle: strings.inlineHelpTitle,
    more: strings.inlineMore,
    moreTitle: strings.inlineMoreTitle,
    done: strings.inlineDone,
    helpEdit: strings.inlineHelpEdit,
    helpCancel: strings.inlineHelpCancel,
    helpPanel: strings.inlineHelpPanel
  }, dirFor(lang), {
    save: () => void commit(),
    revert: () => revertFocused(),
    discard: () => discardAll(),
    exit: () => exit(),
    home: () => tour.wentHome()
  }, {
    /* §1.6: zero routes out of this bar on all three sites, while the help
       text promised one twice. This is the route, and it carries the page
       rather than being a way off it — `back`, never `from`, which the panel
       would act on by sending the owner straight back here. */
    href: panelHref(editorPath, { back: herePath(), lang }),
    label: strings.inlineHome
  });

  /* §2.5's first run. Built here so the bar's `home` callback above has
     something to call, and *started* far below — only once every annotation has
     been judged, because a tour that says "tap the highlighted words" on a page
     with none is worse than no tour. Its steps live in `tour.ts`, which knows
     nothing about a bar; this is the view. */
  const tour = new Tour(
    {
      /* `refresh()` after each transition, because the status line's own
         sentence depends on which step is showing — see the `tour.showing === 1`
         branch there. Without it the bar would keep whichever sentence it was
         holding when the step arrived. */
      show: (step, last) => {
        bar.setTour(stepText(step), {
          label: last ? strings.tourDone : strings.tourSkip,
          run: () => tour.end()
        });
        refresh();
      },
      hide: () => {
        bar.setTour(null);
        refresh();
      },
      spotlight: (on) => bar.spotlight(on)
    },
    tourStorage()
  );

  if (!annotated.length) {
    idle(strings.inlineNothing);
    bar.setNote("", { link: { href: panelHref(editorPath, { back: herePath(), lang }), label: strings.inlinePanelLink } });
    return;
  }

  /* --- what the file says ---------------------------------------------- */

  const query = `${contentPath}?collection=${encodeURIComponent(collection)}${
    entry ? `&entry=${encodeURIComponent(entry)}` : ""
  }`;

  /* Said before the request, not after it. Measured under a GitHub that took
     ten seconds: the bar was on screen the whole time with no words in it at
     all and Save enabled, while the panel in the next window said "Loading…".
     An owner staring at an empty bar has no way to tell a slow network from a
     broken editor — and an enabled Save on a page whose values have not arrived
     is an offer the editor cannot keep. */
  idle(strings.loading);

  let loaded: Response;
  try {
    loaded = await fetch(query, { headers: { accept: "application/json" } });
  } catch {
    idle(strings.startFailed);
    return;
  }

  if (loaded.status === 401) {
    idle(strings.inlineSignIn);
    /* The link remembers this page, and the panel sends them back to it in
       edit mode once they are in. Without that the owner signs in and lands
       on a form, having to find their way back to the sentence they tapped —
       on a phone, by typing `?edit=1` into the URL bar. */
    bar.setNote("", { link: { href: signInBack(), label: strings.inlineSignInLink } });
    return;
  }
  if (loaded.status === 503) {
    idle(strings.notConfigured);
    return;
  }
  if (!loaded.ok) {
    idle(strings.loadFailed);
    return;
  }

  const body = (await loaded.json()) as { sha: string; fields: Field[]; values: unknown };
  sha = body.sha;

  /* A section that is off is not rendered, so the page is not where it gets
     turned back on — and an owner who has just turned one off is standing on
     the one screen that cannot undo it. Said only where it is true: a page
     with nothing hideable would be told about a control it has not got. */
  if (hasToggle(body.fields)) bar.addHelp(strings.inlineHelpHidden);

  /* --- wiring the page -------------------------------------------------- */

  const plaintext = supportsPlaintextOnly();
  let broken = 0;

  for (const element of annotated) {
    const path = element.dataset.skEdit;
    if (!path) continue;

    /* An annotation inside another annotation would give two controls over one
       string, and the inner one would win silently. */
    if (element.parentElement?.closest("[data-sk-edit]")) {
      warn(path, "is nested inside another data-sk-edit element");
      element.dataset.skEditState = "panel";
      continue;
    }

    /* The same path twice — a marquee duplicated to hide its seam, a heading
       repeated in a mobile and a desktop variant. Both would look editable and
       only the last would be wired, so typing in the first would do nothing at
       all. The first one wins and the rest say why. */
    if (editables.has(path)) {
      warn(path, "appears more than once on this page; only the first is editable");
      element.dataset.skEditState = "panel";
      continue;
    }

    const verdict = judge(element, path, body.fields, body.values);

    if (verdict.kind === "broken") {
      element.dataset.skEditState = "broken";
      element.title = fill(strings.inlineBroken, { path });
      warn(path, verdict.reason);
      broken++;
      continue;
    }

    if (verdict.kind === "panel") {
      element.dataset.skEditState = "panel";
      const why = fill(
        verdict.why === "formatting" ? strings.inlinePanelOnly : strings.inlinePanelElsewhere,
        { label: verdict.label }
      );
      element.title = why;
      /* A `title` is a tooltip, and a phone has no pointer to hover with — so
         on the device this editor is for, the greyed-out sentence has always
         explained itself to nobody. Tapping it says the same thing in the bar,
         where there is room for the way to fix it as well: the panel, opened
         at this exact field (§2.3, "the links land on places, not pages").

         Not `continue`d past — the listener hangs off the same AbortController
         as every other one, so leaving edit mode takes it with it. */
      element.addEventListener(
        "click",
        () => {
          bar.setNote(why, {
            link: {
              href: panelHref(editorPath, { back: herePath(), lang, field: path }),
              label: strings.inlinePanelLink
            }
          });
        },
        on
      );
      warn(path, verdict.reason);
      continue;
    }

    dirty.track(path, verdict.value);

    element.setAttribute("contenteditable", plaintext ? "plaintext-only" : "true");
    element.dataset.skEditState = "idle";
    const addedDir = useAutoDirection(element);
    editables.set(path, {
      element,
      path,
      field: verdict.field,
      original: verdict.value,
      addedDir
    });
    element.setAttribute("role", "textbox");
    element.setAttribute("aria-label", verdict.field.label);
    element.spellcheck = true;

    /* Editable text inside a link — Bruce's "Full biography →" button, and the
       three lines inside his Showcase teaser — would otherwise navigate away
       on the tap meant to start editing, losing whatever else was unsaved. */
    if (element.closest("a")) {
      element.addEventListener("click", (event) => event.preventDefault(), on);
    }

    element.addEventListener("focus", () => onFocus(path), on);
    element.addEventListener("blur", () => onBlur(path), on);
    element.addEventListener("input", () => onInput(path), on);
    element.addEventListener("keydown", (event) => onKeydown(event, path), on);
    if (!plaintext) element.addEventListener("paste", onPaste, on);
  }

  if (broken) bar.setNote(strings.inlineBrokenSome, { tone: "bad" });

  /* --- unsaved work from last time -------------------------------------- */

  const verdict = readDraft(sessionStorage, key, sha);
  if (verdict.state === "stale") {
    clearDraft(sessionStorage, key);
    bar.setNote(strings.inlineDraftStale, { tone: "bad" });
  } else if (verdict.state === "usable") {
    const count = plural(verdict.draft.edits.length, strings.change, strings.changes, digits);
    bar.setNote(fill(strings.inlineDraftFound, { count }), {
      actions: [
        { label: strings.inlineDraftRestore, run: () => restore(verdict.draft) },
        {
          label: strings.inlineDraftDiscard,
          run: () => {
            clearDraft(sessionStorage, key);
            bar.clearNote();
          }
        }
      ]
    });
  }

  refresh();
  window.addEventListener("beforeunload", onBeforeUnload, on);

  /* --- the first run ----------------------------------------------------- */

  /* Last, because everything above decides whether there is anything to teach.
     `editables` is empty on a page whose every annotation turned out to be
     panel-only or broken — bez's marquee and watermark are both in that
     position — and on such a page step 1 would be an instruction an owner cannot
     carry out. `annotated.length` is not the same question and returned early
     above; this is the narrower one. */
  if (editables.size) {
    bar.offerTour(strings.inlineHelpTourAgain, () => tour.start(true));
    tour.start(armed);
  }

  /* --- the state machine ------------------------------------------------ */

  function judge(element: HTMLElement, path: string, fields: Field[], values: unknown): Verdict {
    const value = valueAt(values, path);
    if (value === undefined || value === null) {
      return { kind: "broken", reason: "resolves to nothing in the content" };
    }

    const field = findField(fields, path);
    if (!field) {
      return { kind: "broken", reason: "has no field in the form model — is it on the omit list?" };
    }

    if (field.kind !== "text" && field.kind !== "number") {
      return { kind: "panel", why: "elsewhere", reason: `is a ${field.kind} field`, label: field.label };
    }

    /* Hidden from assistive technology, so it must not become focusable.
       `contenteditable` puts an element in the tab order and names it a
       textbox; inside `aria-hidden="true"` that is a focusable control a
       screen-reader user can reach but never be told about, which is a worse
       fault than the missing convenience. Bruce's Persian watermark and his
       marquee are both in this position, and both were skipped by hand when
       his page was annotated — a rule the kit should keep rather than each
       person who annotates a site.

       `role="img"` is the same fault by a different route: it declares its
       whole subtree presentational and replaces it with the accessible name,
       so an element inside one is just as unreachable by description while
       still being reachable by tab. Bruce's showcase interlude is that. */
    const unspoken = element.closest(UNSPOKEN);
    if (unspoken) {
      return {
        kind: "panel",
        why: "elsewhere",
        reason: unspoken.matches('[aria-hidden="true"]') ? "is inside aria-hidden" : 'is inside role="img"',
        label: field.label
      };
    }

    /* Inside a control that does something when tapped. A link is fine — the
       navigation is suppressed while editing — but a control runs the site's
       own JavaScript, and there is no safe way to tell a click meant for the
       control from one meant for the caret. Bruce's video facade is the case:
       tapping its label swaps in the YouTube iframe. */
    const control = element.closest(INTERACTIVE);
    if (control) {
      return {
        kind: "panel",
        why: "elsewhere",
        reason:
          control.localName === "button"
            ? "is inside a button"
            : `is inside role="${control.getAttribute("role")}"`,
        label: field.label
      };
    }

    /* Only an element holding nothing but text can be edited in place.
       `contenteditable` on one with element children lets a keystroke delete
       them, and they are the design: Bruce's about paragraph renders its first
       letter through a drop-cap <span>, and its textContent still equals the
       stored value exactly — so the verbatim check below passes it and the
       owner would watch the drop cap vanish as they typed. Caught by reading a
       real site's markup rather than by using it. */
    if (element.children.length) {
      return { kind: "panel", why: "formatting", reason: "wraps other elements", label: field.label };
    }

    const text = String(value);

    /* Decision 1: a value carrying markup is not inline-editable. Sanitising
       rich contenteditable output properly is a real security surface, and it
       would exist to serve <b> and <em> in a handful of strings. The panel
       shows the raw text, where an owner can see what they are changing. */
    if (text.includes("<")) {
      return { kind: "panel", why: "formatting", reason: "contains markup", label: field.label };
    }

    /* The element has to be *showing* this value, or editing it edits
       something else. A template that upper-cases, truncates or concatenates
       is legitimate — it just cannot be edited in place. Whitespace is
       normalised on both sides first, because Astro's output and a YAML
       folded scalar disagree about newlines without disagreeing about
       content. */
    if (squash(element.textContent ?? "") !== squash(text)) {
      return {
        kind: "panel",
        why: "elsewhere",
        reason: "does not match the text the element is showing",
        label: field.label
      };
    }

    return { kind: "edit", field, value: text };
  }

  function onFocus(path: string): void {
    const target = editables.get(path);
    if (!target) return;
    target.element.dataset.skEditState = "active";
    bar.setStatus(fill(strings.inlineFocused, { what: target.field.label }), target.field.label);
    bar.setRevertVisible(dirty.has(path));
    clear(path);
    /* §2.5 step 1's own ending: the owner tapped the highlighted words, which is
       the whole of what step 1 asked for. */
    tour.focused();
    keepClearOfBar(target.element);
  }

  function onBlur(path: string): void {
    const target = editables.get(path);
    if (!target) return;
    target.element.dataset.skEditState = dirty.has(path) ? "changed" : "idle";
    bar.setRevertVisible(false);
    refresh();
  }

  function onInput(path: string): void {
    const target = editables.get(path);
    if (!target) return;
    const raw = target.element.textContent ?? "";
    const changed = dirty.update(path, raw, coerce(target.field, raw));
    target.element.dataset.skEditState = "active";
    bar.setRevertVisible(changed);
    if (noteIsStaleOnEdit) {
      bar.clearNote();
      noteIsStaleOnEdit = false;
    }
    /* Step 2 is about Save, and Save is not on the bar until there is something
       to save (§2.2) — so the sentence and the button arrive together. `changed`
       rather than `dirty.size`: typing a value back to what the file already says
       has not made anything savable. */
    if (changed) tour.typed();
    refresh();
    persist();
  }

  function onKeydown(event: KeyboardEvent, path: string): void {
    if (event.key === "Escape") {
      event.preventDefault();
      revert(path);
      (event.currentTarget as HTMLElement).blur();
      return;
    }
    /* Enter ends a one-line field rather than putting a newline in a heading.
       `long` is the model's guess at prose — where it says so, Enter behaves
       the way it does in a textarea, because a paragraph legitimately has
       them. */
    const target = editables.get(path);
    if (event.key === "Enter" && target?.field.kind === "text" && !target.field.long) {
      event.preventDefault();
      (event.currentTarget as HTMLElement).blur();
    }
  }

  /* Only reached on browsers without contenteditable="plaintext-only". Pasting
     a heading copied from a Word document would otherwise arrive as markup
     that the YAML writer would then quote verbatim. */
  function onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    const selection = getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    selection.collapseToEnd();
    (event.currentTarget as HTMLElement).dispatchEvent(new Event("input", { bubbles: true }));
  }

  /* --- undo ------------------------------------------------------------- */

  function revert(path: string): void {
    const target = editables.get(path);
    if (!target) return;
    target.element.textContent = target.original;
    dirty.update(path, target.original, coerce(target.field, target.original));
    target.element.dataset.skEditState = "idle";
    clear(path);
    bar.setRevertVisible(false);
    refresh();
    persist();
  }

  function revertFocused(): void {
    const active = document.activeElement as HTMLElement | null;
    const path = active?.dataset?.skEdit;
    if (path) revert(path);
  }

  function discardAll(): void {
    for (const path of [...editables.keys()]) revert(path);
    bar.clearNote();
  }

  function restore(draft: Draft): void {
    for (const [path, raw] of Object.entries(draft.raw)) {
      const target = editables.get(path);
      if (!target) continue;
      target.element.textContent = raw;
      dirty.update(path, raw, coerce(target.field, raw));
      target.element.dataset.skEditState = "changed";
    }
    bar.clearNote();
    refresh();
  }

  /* --- saving ----------------------------------------------------------- */

  async function commit(): Promise<void> {
    /* A phone photograph's worth of latency on a slow connection is exactly
       when an owner taps Save twice. The button is disabled below, but the
       flag is what makes a second call impossible rather than unlikely. */
    if (saving || !dirty.size) return;
    saving = true;
    bar.setSave(saveState(strings.saving, false));
    bar.clearNote();
    for (const { element } of editables.values()) delete element.dataset.skEditIssue;

    let response: Response;
    try {
      response = await fetch(contentPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ collection, entry: entry || undefined, sha, edits: dirty.edits() })
      });
    } catch {
      saving = false;
      bar.setNote(strings.saveFailed, { tone: "bad" });
      refresh();
      return;
    }

    const result = (await response.json().catch(() => ({}))) as {
      sha?: string;
      commit?: string;
      error?: string;
      issues?: { path: string; message: string }[];
    };
    saving = false;

    if (response.ok) {
      /* What was saved is now what the file holds — so typing the old words
         back reads as a change again, and a second edit in the same session
         works. Same rule the panel follows, same class enforcing it. */
      for (const target of editables.values()) {
        if (dirty.has(target.path)) target.original = target.element.textContent ?? "";
      }
      dirty.settle();
      if (result.sha) sha = result.sha;
      clearDraft(sessionStorage, key);
      for (const { element } of editables.values()) {
        if (element.dataset.skEditState === "changed") element.dataset.skEditState = "idle";
      }
      bar.setNote(
        strings.savedNote,
        result.commit ? { tone: "good", link: { href: result.commit, label: strings.savedLink } } : { tone: "good" }
      );
      noteIsStaleOnEdit = true;
      refresh();
      return;
    }

    /* The one failure where nothing is wrong and nothing is lost. The draft
       was written as they typed, so signing in and coming back offers it
       straight away — which is why this says so instead of showing the
       generic "couldn't save" and letting an owner think their afternoon has
       gone. Reached far less often now that a session in use renews itself,
       and still reachable: a rotated secret signs everyone out at once. */
    if (response.status === 401) {
      persist();
      bar.setNote(strings.expired, {
        tone: "bad",
        link: { href: signInBack(), label: strings.expiredLink }
      });
      refresh();
      return;
    }

    if (response.status === 409) {
      bar.setNote(strings.conflict, {
        tone: "bad",
        actions: [{ label: strings.reload, run: () => location.reload() }]
      });
      refresh();
      return;
    }

    if (Array.isArray(result.issues) && result.issues.length) {
      const first = result.issues[0];
      for (const issue of result.issues) {
        const target = editables.get(issue.path);
        if (target) {
          target.element.dataset.skEditIssue = issue.message;
          target.element.title = issue.message;
        }
      }
      bar.setNote(`${strings.invalid} ${first?.message ?? ""}`.trim(), { tone: "bad" });
      if (first) editables.get(first.path)?.element.focus();
      refresh();
      return;
    }

    bar.setNote(result.error ?? strings.saveFailed, { tone: "bad" });
    refresh();
  }

  /* --- the bar's resting state ------------------------------------------ */

  function refresh(): void {
    const count = dirty.size;
    if (document.activeElement && (document.activeElement as HTMLElement).dataset?.skEdit) {
      /* Focus owns the status line; leave it saying what is being changed. */
    } else if (count) {
      const phrase = plural(count, strings.change, strings.changes, digits);
      bar.setStatus(fill(strings.inlinePending, { count: phrase }), phrase);
    } else if (tour.showing === 1) {
      /* Found by looking at the first run in a browser rather than by any
         assertion about it: with both lines showing, the bar said the same
         instruction twice — *"Tap any highlighted text to change it."* dim on one
         row and *"This text is yours — tap the highlighted words to change
         them."* bright on the next, on the one screen a first-time owner reads
         most carefully. Both strings are right in isolation, which is why writing
         them in two different sections of the design hid it.

         Only step 1 duplicates. Step 2's status is "Changing {label}" — the
         worked example §2.5 keeps deliberately — and step 3's is the unsaved
         count. So the weaker sentence stands down for exactly one step, and
         `.bar__status:empty` collapses the row rather than leaving it blank. */
      bar.setStatus("");
    } else {
      bar.setStatus(strings.inlineIdle);
    }
    bar.setSave(saveState(strings.save, count > 0 && !saving));
  }

  /** Save as the bar needs it: the verb on the button, the count on its chip,
      and the whole sentence for anyone listening rather than looking. A count
      of zero is what takes the button off the bar (§2.2), so this is also where
      the resting shape comes from — one place, one arithmetic. */
  function saveState(label: string, enabled: boolean): SaveState {
    const count = dirty.size;
    return {
      label,
      count,
      chip: count ? digits(count) : "",
      sentence: count
        ? fill(strings.saveCount, { count: plural(count, strings.change, strings.changes, digits) })
        : label,
      enabled
    };
  }

  /** The panel, told which page to send them back to — and which language to
      say it in, since the page an owner is standing on is the only evidence
      the panel gets about that. */
  function signInBack(): string {
    return signInHref(editorPath, herePath(), lang);
  }

  /** Which sentence a step says. In one place rather than three, so a step
      number and the words for it cannot drift apart. */
  function stepText(step: TourStep): string {
    return step === 1 ? strings.tourStep1 : step === 2 ? strings.tourStep2 : strings.tourStep3;
  }

  function idle(text: string): void {
    bar.setStatus(text);
    bar.setSave(saveState(strings.save, false));
    bar.setRevertVisible(false);
  }

  function clear(path: string): void {
    const target = editables.get(path);
    if (!target) return;
    delete target.element.dataset.skEditIssue;
    target.element.removeAttribute("title");
  }

  function persist(): void {
    const raw: Record<string, string> = {};
    for (const target of editables.values()) {
      if (dirty.has(target.path)) raw[target.path] = target.element.textContent ?? "";
    }
    saveDraft(sessionStorage, key, { sha, edits: dirty.edits(), raw });
  }

  /* The last line of defence, and the weakest — Safari on iOS ignores it, and
     a killed background tab never fires it at all. The draft above is what
     actually protects the work; this only catches a deliberate navigation. */
  function onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!dirty.size) return;
    event.preventDefault();
    event.returnValue = strings.inlineLeaveWarning;
  }

  function exit(): void {
    if (dirty.size && !confirm(strings.inlineLeaveWarning)) return;
    /* `stop`, not `end`: the flag stays unset. An owner who left edit mode half
       way through the first run has not told us they understood it, and 7.7's
       notice behaves the same way — only "Got it" is a dismissal. */
    tour.stop();
    listeners.abort();
    for (const { element, addedDir } of editables.values()) {
      element.removeAttribute("contenteditable");
      element.removeAttribute("role");
      element.removeAttribute("aria-label");
      if (addedDir) element.removeAttribute("dir");
      delete element.dataset.skEditState;
    }
    for (const element of document.querySelectorAll<HTMLElement>("[data-sk-edit-state]")) {
      delete element.dataset.skEditState;
    }
    bar.destroy();
    try {
      sessionStorage.removeItem("sk-edit-mode");
    } catch {
      /* private browsing — the flag was never stored */
    }
    /* Leaving edit mode should leave the URL an owner could send to someone. */
    const url = new URL(location.href);
    url.searchParams.delete(EDIT_PARAM);
    history.replaceState(null, "", url);
  }

  function keepClearOfBar(element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
    const visible = window.visualViewport?.height ?? window.innerHeight;
    if (rect.bottom > visible - bar.height() || rect.top < 0) {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
}

/* --- small things ------------------------------------------------------- */

/** `dir="auto"` so the caret and the text follow what is being typed rather
    than the page's chrome — a Farsi string edited inside an English page is
    the fleet's normal case, and bez's `hero.nameFa` is exactly it.

    But only where it does not change how the text already looks. `auto` picks
    a direction from the first *strong* character, and a string with none at
    all falls back to LTR: nimagiti's stat figures are "۲۱+" in Persian
    digits, which are bidi-neutral, so stamping `auto` on them moved the plus
    sign 38 pixels across the page the instant edit mode started. Four numbers
    on his live home page, silently rearranged by the tool meant to leave the
    page alone.

    So the site's rendering wins: set `auto`, keep it only if the computed
    direction is unchanged, and report whether it stayed so `exit()` can leave
    the element exactly as it found it.

    @returns whether the attribute was added and should be removed on exit. */
function useAutoDirection(element: HTMLElement): boolean {
  if (element.hasAttribute("dir")) return false;
  const before = getComputedStyle(element).direction;
  element.setAttribute("dir", "auto");
  if (getComputedStyle(element).direction === before) return true;
  element.removeAttribute("dir");
  return false;
}

/** Firefox only shipped `plaintext-only` in 136, and a site's owner may be on
    something older still. The fallback is `true` plus a paste handler, which
    is the same guarantee by a longer route. */
function supportsPlaintextOnly(): boolean {
  const probe = document.createElement("div");
  probe.setAttribute("contenteditable", "plaintext-only");
  return probe.contentEditable === "plaintext-only";
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Does this page's content model have a section that can be turned off? */
function hasToggle(fields: Field[]): boolean {
  return fields.some(
    (field) =>
      (field.kind === "group" && (Boolean(field.toggle) || hasToggle(field.fields))) ||
      (field.kind === "array" && hasToggle([field.item]))
  );
}

/** Annotations rot against redesigns, and a rotted one that does nothing is
    worse than one that complains. The element says so to the owner; this says
    so to whoever has to fix it. */
function warn(path: string, reason: string): void {
  console.warn(`sk inline edit: data-sk-edit="${path}" ${reason}.`);
}
