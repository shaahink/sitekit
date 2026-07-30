/* The owner's editor.
   ---------------------------------------------------------------------------
   Every control on this page is generated from the site's content schemas —
   nothing here knows that one site's home page has a tagline or that another's
   room has pieces. That is the point of PLAN §3.9: adding the editor to the
   next site costs wiring, not a hand-built admin screen.

   It lives in the kit, chrome and all, and CLAUDE.md's "no design system in
   the kit" rule was scoped on 2026-07-28 to say so: that rule is about the
   pages a visitor sees. Four hand-maintained copies of one admin panel is
   precisely what sitekit exists to prevent, and nobody's face is their admin
   panel. A site tunes the look with the --sk-editor-* custom properties and
   the strings with `options.strings`; it never owns a copy.

   The measure of that boundary: a site's editor code is an `edit.astro` that
   calls mountEditor and sets its own CSP, two `api/` edges that read
   environment variables, and a copied stylesheet. If improving the editor ever
   means touching those, the boundary is in the wrong place and should move.

   PLAN §3.9 also says "inline edit", and that is coming as a layer on top of
   this (session 7.6). The panel is the floor because it costs no per-site
   template work and reaches the fields that have no visible DOM at all —
   meta.ogDescription, image alt text, the aria strings. */

import type { Field } from "../cms/fields.js";
import { Dirty } from "./dirty.js";
import { cssEscape, el, labelled, link, reveal } from "./dom.js";
import { loadGis } from "./gis.js";
import { home, type HomeData } from "./home.js";
import { render, Uploads, type RenderContext } from "./render.js";
import { BACK_PARAM, editHref, fieldFromHash, RETURN_PARAM, safeReturnPath } from "./return-to.js";
import {
  digitsFor,
  dirFor,
  editorStrings,
  fill,
  LANG_PARAM,
  LANG_STORE,
  resolveEditorLang,
  type EditorStrings
} from "./strings.js";
import { plural } from "./values.js";

export type { EditorStrings } from "./strings.js";
export type { Field, SelectOption } from "../cms/fields.js";

export interface EditorOptions {
  /** The sign-in edge. Default `/api/auth`. */
  authPath?: string;
  /** The content edge. Default `/api/content`. */
  contentPath?: string;
  /** Overrides for any of the panel's words. */
  strings?: Partial<EditorStrings>;
  /** Force the panel's language instead of resolving one. A site with a single
      audience can pin it; nothing in the fleet needs to. */
  lang?: string;
  /** Google Identity Services' script URL. Overridable for tests; there is no
      reason a site would set it. */
  gisSrc?: string;
}

interface EntryRef {
  id: string;
  label: string;
  /** Where this entry can be seen on the site, if the site said. */
  url?: string;
}

interface CollectionRef {
  name: string;
  label: string;
  entries: EntryRef[];
}

interface Session {
  who?: string;
  collections: CollectionRef[];
}

interface EntryBody {
  path: string;
  sha: string;
  fields: Field[];
  values: unknown;
}

/** Which language the panel speaks, and it remembers the answer.
    ---------------------------------------------------------------------------
    Asked in the order of how much each source knows about this owner: the link
    they followed (the bar puts `?lang=` on its route to the panel, so somebody
    who came from `/fa/` arrives in Farsi), then what they were reading last
    time, then what their browser asks every site for. Whatever wins is written
    back, so an owner who arrives once from a Farsi page keeps Farsi when they
    later open `/edit` on its own.

    Storage is wrapped because private browsing refuses it. A panel that cannot
    remember a language is worth far more than a panel that will not load. */
function panelLang(): string {
  let remembered: string | null = null;
  try {
    remembered = localStorage.getItem(LANG_STORE);
  } catch {
    /* Nothing remembered, and nothing to do about it. */
  }

  const lang = resolveEditorLang({
    asked: new URLSearchParams(location.search).get(LANG_PARAM),
    remembered,
    preferred: navigator.languages
  });

  try {
    localStorage.setItem(LANG_STORE, lang);
  } catch {
    /* Then it is asked again next time, which is the old behaviour. */
  }
  return lang;
}

/** Mounts the panel into `element`, replacing whatever is in it.
    Returns once the first screen — sign-in, or the form — is on the page. */
export async function mountEditor(element: HTMLElement, options: EditorOptions = {}): Promise<void> {
  const lang = options.lang ?? panelLang();
  const strings: EditorStrings = editorStrings(lang, options.strings);
  const auth = options.authPath ?? "/api/auth";
  const content = options.contentPath ?? "/api/content";
  const gisSrc = options.gisSrc;

  /* The document is told what it turned out to be. `lang` because a screen
     reader and the browser's own text handling read the attribute rather than
     our table, and `dir` because the panel's stylesheet is entirely logical
     properties — so one attribute mirrors the whole layout and there is no
     right-to-left sheet to maintain. The route ships `lang="en"` statically
     since a document needs one before any of this runs; this is where it stops
     being a guess. */
  document.documentElement.lang = lang;
  document.documentElement.dir = dirFor(lang);

  /* The class is added here rather than asked of the site, so a site's markup
     is `<main data-sk-editor>` and stays correct across kit versions. */
  element.classList.add("sk-editor");

  const dirty = new Dirty();
  const uploads = new Uploads();

  /* Where the owner was when they were sent here to sign in. Validated in
     return-to.ts: a site-relative path or nothing, because this ends up in
     `location`. */
  const returnTo = safeReturnPath(
    new URLSearchParams(location.search).get(RETURN_PARAM)
  );

  /* Where the owner was when they asked for *this*. `from` above is a journey
     to finish and is acted on before a control is drawn; `back` is a place to
     remember and is offered rather than taken. Two intents, two names — see
     return-to.ts's header, and §2.3, which is the section this whole parameter
     exists to satisfy. */
  const backTo = safeReturnPath(new URLSearchParams(location.search).get(BACK_PARAM));

  /* And which field they were pointing at, where they got here by tapping a
     greyed-out sentence on their own page. Spent once: it is the answer to
     "why did I open the panel", not a preference, and re-applying it every
     time the picker changes would drag an owner who moved on somewhere they
     have already been. */
  let wantedField = fieldFromHash(location.hash);

  async function start(): Promise<void> {
    element.textContent = "";
    const status = el("p", "sk-editor__status", strings.loading);
    element.append(status);

    let session: Response;
    try {
      session = await fetch(content, { headers: { accept: "application/json" } });
    } catch {
      status.textContent = strings.startFailed;
      return;
    }

    if (session.status === 401) {
      status.remove();
      return signIn();
    }
    if (session.status === 503) {
      status.textContent = strings.notConfigured;
      return;
    }
    if (!session.ok) {
      status.textContent = await errorText(session, strings.startFailed);
      return;
    }

    /* Signed in, and they only came here to do that — so finish the journey
       rather than leaving them on a form. The panel is not what they asked
       for; the sentence they tapped on their own page is. */
    if (returnTo) {
      location.replace(editHref(returnTo));
      return;
    }

    const body = (await session.json()) as Session;
    status.remove();
    chrome(body);
  }

  /* --- signing in ----------------------------------------------------- */

  async function signIn(): Promise<void> {
    const card = el("div", "sk-editor__signin");
    card.append(el("h2", "sk-editor__title", strings.signInTitle));
    element.append(card);
    await mountGoogleButton(card, () => void start());
  }

  /** Google's button, in whatever container asked for it, calling back once
      the session exists. Two callers: the sign-in screen, and the note under
      a save that was refused because the session had lapsed — where the whole
      point is that the owner signs in *without the page reloading*, because a
      reload is what would lose the work this is promising to keep. */
  async function mountGoogleButton(host: HTMLElement, onSignedIn: () => void): Promise<void> {
    /* Guarded like every other fetch on this surface. Unguarded, a phone with
       no signal rejected here and took the *caller* with it — and one of the
       two callers is the note under a refused save, where the whole promise is
       that the owner's work survives. See the header of `commit`. */
    let config: { configured?: boolean; clientId?: string };
    try {
      config = (await (await fetch(auth)).json()) as typeof config;
    } catch {
      host.append(el("p", "sk-editor__error", strings.startFailed));
      return;
    }

    if (!config.configured || !config.clientId) {
      host.append(el("p", "sk-editor__note", strings.signInUnavailable));
      return;
    }

    host.append(el("p", "sk-editor__note", strings.signInNote));
    const slot = el("div", "sk-editor__gbutton");
    host.append(slot);

    let gis;
    try {
      gis = await loadGis(gisSrc);
    } catch {
      host.append(el("p", "sk-editor__error", strings.gisFailed));
      return;
    }

    gis.accounts.id.initialize({
      client_id: config.clientId,
      callback: ({ credential }) => {
        void submitCredential(credential, host, onSignedIn);
      }
    });
    gis.accounts.id.renderButton(slot, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "signin_with",
      /* Google renders this in an iframe at a width it is told, and its
         default is a fixed ~200px that sits marooned in the middle of a phone
         screen — the one control on the page, looking like an afterthought.
         Filling the slot is what makes it read as the thing to press. The
         range is Google's: it refuses anything outside 200–400. */
      width: buttonWidth(slot)
    });
  }

  function buttonWidth(slot: HTMLElement): number {
    const available = slot.clientWidth || element.clientWidth;
    return Math.max(200, Math.min(400, Math.round(available) || 320));
  }

  async function submitCredential(
    credential: string | undefined,
    host: HTMLElement,
    onSignedIn: () => void
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(auth, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential })
      });
    } catch {
      host.append(el("p", "sk-editor__error", strings.signInFailed));
      return;
    }
    if (!response.ok) {
      host.append(el("p", "sk-editor__error", await errorText(response, strings.signInFailed)));
      return;
    }
    onSignedIn();
  }

  /* --- the panel ------------------------------------------------------ */

  function chrome(session: Session): void {
    const bar = el("div", "sk-editor__bar");
    if (session.who) bar.append(el("span", "sk-editor__who", session.who));

    const out = el("button", "sk-editor__link", strings.signOut);
    out.type = "button";
    out.addEventListener("click", () => {
      /* `start()` either way: a DELETE that never left the browser has not
         signed anybody out, and re-reading the session is how the panel finds
         out which of those happened. Unhandled, this was the fourth rejection
         on this surface with nowhere to land. */
      void fetch(auth, { method: "DELETE" })
        .catch(() => {})
        .then(() => start());
    });
    bar.append(out);

    const picker = el("div", "sk-editor__picker");
    const select = el("select", "sk-editor__input sk-editor__select");
    select.id = "sk-editor-collection";
    select.name = "collection";

    /* Which entries can be seen on the site, so the link below can offer to
       go and edit one in place. This is the *only* route to inline editing
       that does not involve typing `?edit=1` into a URL bar, which is to say
       the only one that exists on a phone. A site that has not declared its
       entry URLs simply doesn't get the link. */
    const urls = new Map<string, string>();

    for (const collection of session.collections) {
      for (const entry of collection.entries) {
        if (entry.url) urls.set(`${collection.name}/${entry.id}`, entry.url);
        /* A multi-entry collection names the entry as well as the collection.
           On a bilingual site that is the whole safeguard against editing the
           French page believing it is the English one — so the entry's label
           comes from the site's own config where it has one, not from a file
           name that only reads as a locale if you already know. */
        const text =
          collection.entries.length > 1 ? `${collection.label} — ${entry.label}` : collection.label;
        const option = el("option", "", text);
        option.value = `${collection.name}/${entry.id}`;
        select.append(option);
      }
    }
    picker.append(labelled(strings.editing, select));

    /* Arriving from a page means arriving to edit *that* page. Without this an
       owner who tapped Home on the Farsi half of a bilingual site would land
       on the English entry — the picker's first option — and the field the bar
       named would either be missing or be the wrong language's. The site
       already declares these URLs for the reverse direction, so this costs a
       lookup and no new configuration. */
    if (backTo) {
      const here = pathOf(backTo);
      for (const [value, url] of urls) {
        if (pathOf(url) === here) {
          select.value = value;
          break;
        }
      }
    }

    /* Rebuilt rather than kept and re-pointed: an anchor that is sometimes
       there and sometimes not is one fewer state than an anchor that is
       always there and sometimes lies about where it goes.

       It lives in the sticky footer since 0.17.0 and not here. §1.6 measured
       it 1,088–1,246px down the panel on all three sites — off the bottom of
       a phone, behind the welcome notice, the traffic, the changes and the
       picker — which is a route that exists and cannot be found. The footer is
       already `position: sticky` (`editor.css`), which is why Save is on
       screen at every scroll position, and there is exactly one other thing
       that deserves to be. */
    const route = el("p", "sk-editor__route");
    const showRoute = (): void => {
      route.textContent = "";
      /* One route, not two: *Back to the page* when the owner came from one —
         `strings.backToPage` was written for this and referenced by nothing
         until now — and *Edit this page on the site* otherwise. Two links to
         two nearly-identical places is how a footer stops being read. */
      if (backTo) {
        route.append(link(editHref(backTo), strings.backToPage));
        return;
      }
      const url = urls.get(select.value);
      if (url) route.append(link(editHref(url), strings.openPage));
    };

    /* Above the picker, because it is what an owner arrives with: what is
       this, did anyone come, did my last change go live. It is built empty and
       filled when its data lands — the form must never wait on analytics. */
    const owner = home({
      strings,
      onRequest: (text) => sendRequest(text)
    });

    const form = el("div", "sk-editor__form");
    const footer = el("div", "sk-editor__footer");
    element.append(bar, owner.element, picker, form, footer);

    /* Not awaited, and its failure is swallowed on purpose. 7.7: "a slow or
       dead Umami cannot delay the form rendering — load it after, and let it
       fail silently." An owner who came to fix a typo should not be told about
       an analytics outage. */
    void fetch(`${content}?home`, { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: (HomeData & { ok?: boolean }) | null) => {
        if (body?.ok) owner.setData(body);
      })
      .catch(() => {});

    select.addEventListener("change", () => {
      showRoute();
      void load(select.value, form, footer, route);
    });
    showRoute();
    void load(select.value, form, footer, route);
  }

  /** A path with its query, its hash and its trailing slash taken off, for
      comparing one route's idea of a page with another's.

      The trailing slash is not fussiness. Measured on nimagiti: its schema
      declares `entryUrl: { "home.fa": "/fa" }` while Astro's default
      `build.format` serves that page at `/fa/`, so the browser's own
      `location.pathname` and the site's own configuration disagree about the
      same page by one character. Without this, an owner tapping Home on the
      Farsi half of a bilingual site lands on the English entry. */
  function pathOf(url: string): string {
    const path = url.split(/[?#]/)[0] ?? url;
    return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  }

  /** The panel was asked for a particular field, by the hash on its own URL.
      The bar's greyed-out-text route names one: an owner who tapped a sentence
      that cannot be edited in place should land on the control that changes
      it, not on a form to search.

      Ancestors are opened from the element outwards rather than at the top
      level, so §2.4's collapse — which since 0.17.0 is what those ancestors
      *are* — inherited this for free, and a nested collapse later needs
      nothing. This is §2.4's third auto-open rule and it was built before the
      thing it opens. */
  function revealField(form: HTMLElement, path: string): void {
    const target = form.querySelector<HTMLElement>(`[data-path="${cssEscape(path)}"]`);
    if (!target) return;
    reveal(target);
    target.scrollIntoView({ block: "center" });
    /* Focused as well as scrolled to, because "which one did it mean?" is a
       question a caret answers and a scroll position does not. Guarded: a
       control the browser refuses to focus must not take the panel down. */
    try {
      target.focus({ preventScroll: true });
    } catch {
      /* Then it is merely scrolled to, which was the whole ask. */
    }
  }

  async function load(
    value: string,
    form: HTMLElement,
    footer: HTMLElement,
    route: HTMLElement
  ): Promise<void> {
    const slash = value.indexOf("/");
    const collection = value.slice(0, slash);
    const entry = value.slice(slash + 1);

    form.textContent = "";
    footer.textContent = "";
    /* The route goes back immediately, before the fetch. A load that fails
       must not also take away the way out of the failure — and until 0.17.0
       it could not, because this link lived beside the picker rather than in
       the footer this line clears. It is re-ordered into place below. */
    footer.append(route);
    form.append(el("p", "sk-editor__status", strings.loading));

    let response: Response;
    try {
      response = await fetch(
        `${content}?collection=${encodeURIComponent(collection)}&entry=${encodeURIComponent(entry)}`
      );
    } catch {
      form.textContent = "";
      form.append(el("p", "sk-editor__error", strings.loadFailed));
      return;
    }
    form.textContent = "";
    if (!response.ok) {
      form.append(el("p", "sk-editor__error", await errorText(response, strings.loadFailed)));
      return;
    }

    const body = (await response.json()) as EntryBody;
    dirty.reset();
    uploads.clear();

    const save = el("button", "sk-editor__save", strings.save);
    save.type = "button";
    save.disabled = true;
    const note = el("p", "sk-editor__note", fill(strings.editingFile, { path: body.path }));

    /* Which held fields have already been shown. §2.4's first rule opens the
       section around a field that is holding Save, and `changed()` runs on every
       keystroke — so without this, an owner who deliberately collapsed a section
       with an undescribed photograph in it would have it reopened under them
       every time they typed anywhere else. The rule is about the moment a field
       *becomes* the reason Save will not go. */
    const shown = new Set<string>();

    const context: RenderContext = {
      strings,
      dirty,
      uploads,
      /* Same collection and entry the form came from, so the handler can read
         the field's own stored value rather than being told a path. */
      previewUrl: (fieldPath) =>
        `${content}?collection=${encodeURIComponent(collection)}&entry=${encodeURIComponent(entry)}` +
        `&preview=${encodeURIComponent(fieldPath)}`,
      changed: () => {
        /* A new photograph with nothing written about it holds Save. The
           schema defaults `alt` to "" and will accept the commit happily, so
           this is the only place it is ever asked — and asking after the fact
           is asking never. */
        const undescribed = uploads.missingAlt(body.values);
        save.disabled = dirty.size === 0 || undescribed.length > 0;
        save.textContent = dirty.size
          ? fill(strings.saveCount, {
              count: plural(dirty.size, strings.change, strings.changes, digitsFor(lang))
            })
          : strings.save;
        if (undescribed.length) {
          note.textContent = strings.imageNeedsAlt;
          for (const path of undescribed) {
            const field = form.querySelector<HTMLElement>(`[data-path="${cssEscape(path)}"]`);
            field?.classList.add("is-wanted");
            /* §2.4's first rule, and the one way the collapse could be worse
               than the form it replaces: a Save that will not go, for a reason
               shut inside a box. The note under the button says what is wanted;
               this is what makes the field it names reachable. */
            if (field && !shown.has(path)) {
              shown.add(path);
              reveal(field);
            }
          }
        } else {
          shown.clear();
          for (const marked of form.querySelectorAll(".is-wanted")) marked.classList.remove("is-wanted");
          if (note.textContent === strings.imageNeedsAlt) {
            note.textContent = fill(strings.editingFile, { path: body.path });
          }
        }
      }
    };

    /* `collapsed` is passed here and nowhere else, which is the whole of §2.4's
       "only the top level": `render` recurses without it, so a list's rows and a
       nested group keep the open box they have always had. */
    for (const field of body.fields) {
      form.append(render(field, body.values, context, { collapsed: true }));
    }
    /* What file is open, the way to the other surface, and Save — in that
       order, so Save stays at the end of the row where a thumb already knows
       to find it (`justify-content: space-between`). All three on screen at
       every scroll position, which is what §2.3 asked the footer for.
       `replaceChildren` rather than `append`, because the route is already in
       here and this is where it takes its place in the middle. */
    footer.replaceChildren(note, route, save);

    /* After the fields exist, because it is one of them it is looking for. */
    if (wantedField) {
      revealField(form, wantedField);
      wantedField = null;
    }

    let sha = body.sha;
    save.addEventListener("click", () => {
      void commit({
        collection,
        entry,
        sha,
        form,
        save,
        note,
        resting: fill(strings.editingFile, { path: body.path }),
        changed: context.changed
      }).then(
        (next) => {
          if (next) sha = next;
        },
        /* A backstop, not the fix: `commit` handles its own failures, and this
           is here so that no future one can ever leave the button disabled with
           nothing said. A save button that cannot be pressed again and gives no
           reason is the worst state this panel can reach, and it was reachable
           by one unhandled rejection. */
        (error: unknown) => {
          console.error("sk-editor: save failed unexpectedly:", error);
          save.disabled = false;
          save.textContent = strings.save;
          note.textContent = strings.saveUnreachable;
        }
      );
    });
  }

  /* --- saving --------------------------------------------------------- */

  async function commit(args: {
    collection: string;
    entry: string;
    sha: string;
    form: HTMLElement;
    save: HTMLButtonElement;
    note: HTMLElement;
    /** What the note says when nothing has gone wrong — restored after a
        failure the owner has since dealt with. */
    resting: string;
    /** Puts the save button back to "Save 2 changes" from whatever the
        failure left it saying. */
    changed: () => void;
  }): Promise<string | null> {
    const { form, save, note } = args;
    save.disabled = true;
    save.textContent = strings.saving;
    for (const stale of form.querySelectorAll(".sk-editor__issue")) stale.remove();

    /* The one measured failure that was both silent and permanent.
       -------------------------------------------------------------------
       Unguarded, a dropped connection rejected here: the button stayed
       "Saving…" and disabled for as long as the tab was open, the note went on
       saying which file was being edited, and nothing on screen said anything
       had gone wrong. Session 16, drill 2b — the harness killed 120ms after
       Save was pressed, in a real browser, on the surface an owner reaches
       first. The inline editor wraps its own save and recovered correctly in
       the same drill, which is what made this a gap rather than a design.

       The words are all still here — `dirty` and the form both hold them — so
       the honest instruction is to press Save again and *not* to reload. The
       panel has no draft on disk to reload into; that is the other half of the
       fix and it is E1's, because a restore that silently drops a photograph an
       owner had chosen would be a new loss wearing a fix's clothes. */
    let response: Response;
    try {
      response = await fetch(content, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          collection: args.collection,
          entry: args.entry,
          sha: args.sha,
          edits: dirty.edits(),
          /* Beside the edits, never inside them: an edit says `upload:u1` and
             the server decides where the file lands. Omitted entirely when
             there are none, so a text-only save is the same request it has
             always been and still goes down the Contents API path. */
          ...(uploads.size ? { uploads: uploads.list() } : {})
        })
      });
    } catch {
      save.disabled = false;
      save.textContent = strings.save;
      note.textContent = strings.saveUnreachable;
      return null;
    }

    const body = (await response.json().catch(() => ({}))) as {
      sha?: string;
      commit?: string;
      error?: string;
      issues?: { path: string; message: string }[];
    };

    if (response.ok) {
      dirty.settle();
      /* The photographs are in the repository now, so a second save must not
         send them again — the same bytes would be hashed to the same filename
         and committed a second time for nothing. */
      uploads.clear();
      for (const changed of form.querySelectorAll(".is-changed")) changed.classList.remove("is-changed");
      save.textContent = strings.saved;
      note.textContent = "";
      note.append(document.createTextNode(strings.savedNote));
      if (body.commit) note.append(link(body.commit, strings.savedLink));
      return body.sha ?? null;
    }

    save.disabled = false;
    save.textContent = strings.save;

    /* Signed out mid-edit. Nothing typed is lost, because the form and
       `dirty` both still hold it — which is exactly why signing in again
       happens *here*, in a block under the button, rather than by sending the
       owner to a sign-in page. A navigation would lose the work this is
       promising to keep. Afterwards Save is simply pressable again.

       Rare now that a session in use renews itself, and still reachable: a
       rotated CMS_SESSION_SECRET signs everybody out mid-sentence. */
    if (response.status === 401) {
      note.textContent = strings.expired;
      const again = el("div", "sk-editor__reauth");
      note.after(again);
      void mountGoogleButton(again, () => {
        again.remove();
        note.textContent = args.resting;
        args.changed();
      });
      return null;
    }

    /* Field-level messages go next to the field they are about; anything else
       goes under the button.

       §2.4's second rule is here: a message beside a field is worth nothing if
       the field is inside a collapsed section, so every one of them opens its
       own, and the first takes the caret. The inline surface has always done
       this — `editables.get(first.path)?.element.focus()` — and the panel said
       "that change doesn't fit the content model" and left the owner to find
       out where. */
    if (Array.isArray(body.issues) && body.issues.length) {
      let first: HTMLElement | null = null;
      for (const issue of body.issues) {
        const input = form.querySelector<HTMLElement>(`[data-path="${cssEscape(issue.path)}"]`);
        const message = el("p", "sk-editor__issue", issue.message);
        if (input?.parentElement) input.parentElement.append(message);
        else note.after(message);
        if (input) {
          reveal(input);
          first ??= input;
        }
      }
      note.textContent = strings.invalid;
      if (first) {
        first.scrollIntoView({ block: "center" });
        try {
          first.focus({ preventScroll: true });
        } catch {
          /* Then it is merely scrolled to and opened, which is most of the ask. */
        }
      }
      return null;
    }

    note.textContent = body.error ?? strings.saveFailed;
    if (response.status === 409) {
      const again = el("button", "sk-editor__link", strings.reload);
      again.type = "button";
      again.addEventListener("click", () => location.reload());
      note.append(" ", again);
    }
    return null;
  }

  /** "Ask for a change" — the same edge as a save, and the only POST here that
      writes nothing to the content. Rejects with a message worth reading; the
      panel keeps whatever was typed either way. */
  async function sendRequest(text: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch(content, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: { text, page: location.pathname } })
      });
    } catch {
      /* The caller shows `error.message` verbatim, so an unguarded rejection
         here put the browser's own "Failed to fetch" in front of an owner. */
      throw new Error(strings.homeRequestFailed);
    }
    if (!response.ok) {
      throw new Error(await errorText(response, strings.homeRequestFailed));
    }
    const body = (await response.json()) as { request?: { url?: string } };
    return body.request?.url ?? "";
  }

  async function errorText(response: Response, fallback: string): Promise<string> {
    try {
      const body = (await response.json()) as { error?: string };
      return body.error ?? fallback;
    } catch {
      return fallback;
    }
  }

  await start();
}
