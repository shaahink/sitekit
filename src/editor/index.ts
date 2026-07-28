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
import { cssEscape, el, labelled, link } from "./dom.js";
import { loadGis } from "./gis.js";
import { home, type HomeData } from "./home.js";
import { render, Uploads, type RenderContext } from "./render.js";
import { editHref, RETURN_PARAM, safeReturnPath } from "./return-to.js";
import { defaultStrings, fill, type EditorStrings } from "./strings.js";
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

/** Mounts the panel into `element`, replacing whatever is in it.
    Returns once the first screen — sign-in, or the form — is on the page. */
export async function mountEditor(element: HTMLElement, options: EditorOptions = {}): Promise<void> {
  const strings: EditorStrings = { ...defaultStrings, ...options.strings };
  const auth = options.authPath ?? "/api/auth";
  const content = options.contentPath ?? "/api/content";
  const gisSrc = options.gisSrc;

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
    const config = (await (await fetch(auth)).json()) as {
      configured?: boolean;
      clientId?: string;
    };

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
    const response = await fetch(auth, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential })
    });
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
      void fetch(auth, { method: "DELETE" }).then(() => start());
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

    /* Rebuilt rather than kept and re-pointed: an anchor that is sometimes
       there and sometimes not is one fewer state than an anchor that is
       always there and sometimes lies about where it goes. */
    const onPage = el("p", "sk-editor__onpage");
    const showOnPage = (): void => {
      onPage.textContent = "";
      const url = urls.get(select.value);
      if (url) onPage.append(link(editHref(url), strings.openPage));
    };
    picker.append(onPage);

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
      showOnPage();
      void load(select.value, form, footer);
    });
    showOnPage();
    void load(select.value, form, footer);
  }

  async function load(value: string, form: HTMLElement, footer: HTMLElement): Promise<void> {
    const slash = value.indexOf("/");
    const collection = value.slice(0, slash);
    const entry = value.slice(slash + 1);

    form.textContent = "";
    footer.textContent = "";
    form.append(el("p", "sk-editor__status", strings.loading));

    const response = await fetch(
      `${content}?collection=${encodeURIComponent(collection)}&entry=${encodeURIComponent(entry)}`
    );
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

    const context: RenderContext = {
      strings,
      dirty,
      uploads,
      changed: () => {
        /* A new photograph with nothing written about it holds Save. The
           schema defaults `alt` to "" and will accept the commit happily, so
           this is the only place it is ever asked — and asking after the fact
           is asking never. */
        const undescribed = uploads.missingAlt(body.values);
        save.disabled = dirty.size === 0 || undescribed.length > 0;
        save.textContent = dirty.size
          ? fill(strings.saveCount, {
              count: plural(dirty.size, strings.change, strings.changes)
            })
          : strings.save;
        if (undescribed.length) {
          note.textContent = strings.imageNeedsAlt;
          for (const path of undescribed) {
            form.querySelector<HTMLElement>(`[data-path="${cssEscape(path)}"]`)?.classList.add("is-wanted");
          }
        } else {
          for (const marked of form.querySelectorAll(".is-wanted")) marked.classList.remove("is-wanted");
          if (note.textContent === strings.imageNeedsAlt) {
            note.textContent = fill(strings.editingFile, { path: body.path });
          }
        }
      }
    };

    for (const field of body.fields) form.append(render(field, body.values, context));
    footer.append(note, save);

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
      }).then((next) => {
        if (next) sha = next;
      });
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

    const response = await fetch(content, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        collection: args.collection,
        entry: args.entry,
        sha: args.sha,
        edits: dirty.edits(),
        /* Beside the edits, never inside them: an edit says `upload:u1` and
           the server decides where the file lands. Omitted entirely when there
           are none, so a text-only save is the same request it has always
           been and still goes down the Contents API path. */
        ...(uploads.size ? { uploads: uploads.list() } : {})
      })
    });

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
       goes under the button. */
    if (Array.isArray(body.issues) && body.issues.length) {
      for (const issue of body.issues) {
        const input = form.querySelector(`[data-path="${cssEscape(issue.path)}"]`);
        const message = el("p", "sk-editor__issue", issue.message);
        if (input?.parentElement) input.parentElement.append(message);
        else note.after(message);
      }
      note.textContent = strings.invalid;
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
    const response = await fetch(content, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: { text, page: location.pathname } })
    });
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
