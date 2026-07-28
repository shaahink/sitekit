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
import { render, type RenderContext } from "./render.js";
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

    const body = (await session.json()) as Session;
    status.remove();
    chrome(body);
  }

  /* --- signing in ----------------------------------------------------- */

  async function signIn(): Promise<void> {
    const card = el("div", "sk-editor__signin");
    card.append(el("h2", "sk-editor__title", strings.signInTitle));

    const config = (await (await fetch(auth)).json()) as {
      configured?: boolean;
      clientId?: string;
    };

    if (!config.configured || !config.clientId) {
      card.append(el("p", "sk-editor__note", strings.signInUnavailable));
      element.append(card);
      return;
    }

    card.append(el("p", "sk-editor__note", strings.signInNote));
    const slot = el("div", "sk-editor__gbutton");
    card.append(slot);
    element.append(card);

    let gis;
    try {
      gis = await loadGis(gisSrc);
    } catch {
      card.append(el("p", "sk-editor__error", strings.gisFailed));
      return;
    }

    gis.accounts.id.initialize({
      client_id: config.clientId,
      callback: ({ credential }) => {
        void submitCredential(credential, card);
      }
    });
    gis.accounts.id.renderButton(slot, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "signin_with"
    });
  }

  async function submitCredential(credential: string | undefined, card: HTMLElement): Promise<void> {
    const response = await fetch(auth, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential })
    });
    if (!response.ok) {
      card.append(el("p", "sk-editor__error", await errorText(response, strings.signInFailed)));
      return;
    }
    await start();
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

    for (const collection of session.collections) {
      for (const entry of collection.entries) {
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

    const form = el("div", "sk-editor__form");
    const footer = el("div", "sk-editor__footer");
    element.append(bar, picker, form, footer);

    select.addEventListener("change", () => void load(select.value, form, footer));
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

    const save = el("button", "sk-editor__save", strings.save);
    save.type = "button";
    save.disabled = true;
    const note = el("p", "sk-editor__note", fill(strings.editingFile, { path: body.path }));

    const context: RenderContext = {
      strings,
      dirty,
      changed: () => {
        save.disabled = dirty.size === 0;
        save.textContent = dirty.size
          ? fill(strings.saveCount, {
              count: plural(dirty.size, strings.change, strings.changes)
            })
          : strings.save;
      }
    };

    for (const field of body.fields) form.append(render(field, body.values, context));
    footer.append(note, save);

    let sha = body.sha;
    save.addEventListener("click", () => {
      void commit({ collection, entry, sha, form, save, note }).then((next) => {
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
        edits: dirty.edits()
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
      for (const changed of form.querySelectorAll(".is-changed")) changed.classList.remove("is-changed");
      save.textContent = strings.saved;
      note.textContent = "";
      note.append(document.createTextNode(strings.savedNote));
      if (body.commit) note.append(link(body.commit, strings.savedLink));
      return body.sha ?? null;
    }

    save.disabled = false;
    save.textContent = strings.save;

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
