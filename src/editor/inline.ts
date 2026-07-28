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
import { Bar } from "./inline-bar.js";
import { defaultStrings, fill, type EditorStrings } from "./strings.js";
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
}

interface Editable {
  element: HTMLElement;
  path: string;
  field: Field;
  /** What the file says today. Updated on every successful save, so a second
      edit in the same session compares against the right thing. */
  original: string;
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
  const strings: EditorStrings = { ...defaultStrings, ...options.strings };
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

  const bar = new Bar(cssHref, {
    regionLabel: strings.inlineHelpTitle,
    save: strings.save,
    revert: strings.inlineRevert,
    discard: strings.inlineDiscard,
    help: strings.inlineHelp,
    helpTitle: strings.inlineHelpTitle,
    done: strings.inlineDone,
    helpEdit: strings.inlineHelpEdit,
    helpCancel: strings.inlineHelpCancel,
    helpSave: strings.inlineHelpSave,
    helpPanel: strings.inlineHelpPanel
  }, {
    save: () => void commit(),
    revert: () => revertFocused(),
    discard: () => discardAll(),
    exit: () => exit()
  });

  if (!annotated.length) {
    idle(strings.inlineNothing);
    bar.setNote("", { link: { href: editorPath, label: strings.inlinePanelLink } });
    return;
  }

  /* --- what the file says ---------------------------------------------- */

  const query = `${contentPath}?collection=${encodeURIComponent(collection)}${
    entry ? `&entry=${encodeURIComponent(entry)}` : ""
  }`;

  let loaded: Response;
  try {
    loaded = await fetch(query, { headers: { accept: "application/json" } });
  } catch {
    idle(strings.startFailed);
    return;
  }

  if (loaded.status === 401) {
    idle(strings.inlineSignIn);
    bar.setNote("", { link: { href: editorPath, label: strings.inlineSignInLink } });
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
      element.title = fill(
        verdict.why === "formatting" ? strings.inlinePanelOnly : strings.inlinePanelElsewhere,
        { label: verdict.label }
      );
      warn(path, verdict.reason);
      continue;
    }

    dirty.track(path, verdict.value);
    editables.set(path, { element, path, field: verdict.field, original: verdict.value });

    element.setAttribute("contenteditable", plaintext ? "plaintext-only" : "true");
    element.dataset.skEditState = "idle";
    /* The content's own direction, not the page's — a Farsi string being
       edited inside an English chrome is nimagiti's normal case. */
    element.setAttribute("dir", "auto");
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
    const count = plural(verdict.draft.edits.length, strings.change, strings.changes);
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
    bar.setSave(strings.saving, false);
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
      const phrase = plural(count, strings.change, strings.changes);
      bar.setStatus(fill(strings.inlinePending, { count: phrase }), phrase);
    } else {
      bar.setStatus(strings.inlineIdle);
    }
    bar.setSave(
      count ? fill(strings.saveCount, { count: plural(count, strings.change, strings.changes) }) : strings.save,
      count > 0 && !saving
    );
    bar.setDiscardVisible(count > 0);
  }

  function idle(text: string): void {
    bar.setStatus(text);
    bar.setSave(strings.save, false);
    bar.setDiscardVisible(false);
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
    listeners.abort();
    for (const { element } of editables.values()) {
      element.removeAttribute("contenteditable");
      element.removeAttribute("role");
      element.removeAttribute("aria-label");
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
    url.searchParams.delete("edit");
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

/** Annotations rot against redesigns, and a rotted one that does nothing is
    worse than one that complains. The element says so to the owner; this says
    so to whoever has to fix it. */
function warn(path: string, reason: string): void {
  console.warn(`sk inline edit: data-sk-edit="${path}" ${reason}.`);
}
