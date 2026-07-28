/* The bar an owner drives inline editing from.
   ---------------------------------------------------------------------------
   In a shadow root, and that is not decoration. This element is injected into
   four sites that share no CSS, plus every site made from the template later.
   A site with `button { text-transform: uppercase }`, or an inherited
   `letter-spacing` on <body>, or a `* { box-sizing: content-box }` would each
   quietly redesign the owner's only controls. Shadow DOM plus `all: initial`
   on the host is the one boundary that holds without anybody having to
   remember it per site.

   Its stylesheet is <link>ed from the site's public/ rather than imported or
   inlined, so `style-src 'self'` covers it and no public page's CSP changes.
   The bar stays hidden until that sheet has loaded — an unstyled toolbar on
   top of someone's homepage is worse than no toolbar for 40ms.

   Positioning is the whole mobile story. `position: fixed` on iOS is fixed to
   the *layout* viewport, so an on-screen keyboard covers it exactly when it is
   needed most. visualViewport gives the real inset, and the bar rides above
   it. */

const HOST_TAG = "sk-inline-editor";

export interface BarButtons {
  save(): void;
  revert(): void;
  discard(): void;
  exit(): void;
}

export interface NoteAction {
  label: string;
  run(): void;
}

export class Bar {
  private readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  /** The same sheet again, in the page's head. The annotated elements are the
      site's own headings and paragraphs — light DOM by definition — so the
      copy inside the shadow root cannot reach them. One URL, so it is one
      request and one cache entry. */
  private readonly pageSheet: HTMLLinkElement;
  private readonly bar: HTMLElement;
  private readonly status: HTMLParagraphElement;
  private readonly note: HTMLParagraphElement;
  private readonly help: HTMLElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly revertButton: HTMLButtonElement;
  private readonly discardButton: HTMLButtonElement;
  private readonly helpButton: HTMLButtonElement;
  private readonly exitButton: HTMLButtonElement;

  constructor(cssHref: string, strings: BarStrings, buttons: BarButtons) {
    /* A custom element name rather than a div: it cannot collide with a site's
       selectors, and it shows up in devtools as what it is. */
    this.host = document.createElement(HOST_TAG);
    this.root = this.host.attachShadow({ mode: "open" });

    const sheet = document.createElement("link");
    sheet.rel = "stylesheet";
    sheet.href = cssHref;

    this.bar = document.createElement("div");
    this.bar.className = "bar";
    this.bar.hidden = true;
    /* Announced, but never stealing focus from the text being typed. */
    this.bar.setAttribute("role", "region");
    this.bar.setAttribute("aria-label", strings.regionLabel);

    sheet.addEventListener("load", () => (this.bar.hidden = false));
    /* If the stylesheet 404s — a site that has not re-run `npm run editor` —
       an unstyled bar is still far better than an invisible one. */
    sheet.addEventListener("error", () => (this.bar.hidden = false));

    this.status = document.createElement("p");
    this.status.className = "bar__status";
    this.status.setAttribute("aria-live", "polite");

    const actions = document.createElement("div");
    actions.className = "bar__actions";

    this.pageSheet = document.createElement("link");
    this.pageSheet.rel = "stylesheet";
    this.pageSheet.href = cssHref;
    document.head.append(this.pageSheet);

    /* Both start hidden: at rest there is nothing to undo, and a control that
       does nothing is worse than one that is not there. */
    this.revertButton = button("btn--quiet", strings.revert, buttons.revert);
    this.revertButton.hidden = true;
    this.discardButton = button("btn--quiet", strings.discard, buttons.discard);
    this.discardButton.hidden = true;
    this.helpButton = button("btn--icon", strings.help, () => this.toggleHelp());
    this.helpButton.setAttribute("aria-label", strings.helpTitle);
    this.helpButton.setAttribute("aria-expanded", "false");
    this.exitButton = button("", strings.done, buttons.exit);
    this.saveButton = button("btn--primary", strings.save, buttons.save);

    const spacer = document.createElement("span");
    spacer.className = "bar__spacer";

    actions.append(
      this.revertButton,
      this.discardButton,
      spacer,
      this.helpButton,
      this.exitButton,
      this.saveButton
    );

    this.note = document.createElement("p");
    this.note.className = "bar__note";
    this.note.hidden = true;

    this.help = document.createElement("div");
    this.help.className = "bar__help";
    this.help.hidden = true;
    this.help.append(helpList(strings));

    const main = document.createElement("div");
    main.className = "bar__main";
    main.append(this.status, actions);
    this.bar.append(main, this.note, this.help);
    this.root.append(sheet, this.bar);
    document.body.append(this.host);

    this.followKeyboard();
  }

  /* --- what it says --------------------------------------------------- */

  /** `what` is the field's own label, brightened inside the sentence — the
      answer to "what am I changing?" should not need parsing. */
  setStatus(text: string, what?: string): void {
    this.status.textContent = "";
    if (!what) {
      this.status.textContent = text;
      return;
    }
    const [before, ...rest] = text.split(what);
    const strong = document.createElement("span");
    strong.className = "bar__what";
    strong.textContent = what;
    this.status.append(before ?? "", strong, rest.join(what));
  }

  setSave(label: string, enabled: boolean): void {
    this.saveButton.textContent = label;
    this.saveButton.disabled = !enabled;
  }

  setRevertVisible(visible: boolean): void {
    this.revertButton.hidden = !visible;
  }

  setDiscardVisible(visible: boolean): void {
    this.discardButton.hidden = !visible;
  }

  /** A line under the controls: an error, a confirmation, or a question with
      one or two things to press. */
  setNote(
    text: string,
    options: { tone?: "bad" | "good"; actions?: NoteAction[]; link?: { href: string; label: string } } = {}
  ): void {
    this.note.textContent = text;
    this.note.hidden = false;
    if (options.tone) this.note.dataset.tone = options.tone;
    else delete this.note.dataset.tone;

    for (const action of options.actions ?? []) {
      this.note.append(" ", button("btn--quiet", action.label, action.run));
    }
    if (options.link) {
      const anchor = document.createElement("a");
      anchor.href = options.link.href;
      anchor.textContent = options.link.label;
      this.note.append(" ", anchor);
    }
  }

  clearNote(): void {
    this.note.textContent = "";
    this.note.hidden = true;
  }

  private toggleHelp(): void {
    this.help.hidden = !this.help.hidden;
    this.helpButton.setAttribute("aria-expanded", String(!this.help.hidden));
  }

  /* --- where it sits ---------------------------------------------------- */

  /** How much of the bottom of the window the bar is occupying, so the thing
      being edited can be scrolled clear of it. */
  height(): number {
    return this.bar.getBoundingClientRect().height + 16;
  }

  /** Ride above the on-screen keyboard. Without this the bar — and therefore
      Save — sits underneath it on every iPhone. */
  private followKeyboard(): void {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const place = (): void => {
      const inset = window.innerHeight - (viewport.height + viewport.offsetTop);
      this.host.style.transform = inset > 0 ? `translateY(${-inset}px)` : "";
    };
    viewport.addEventListener("resize", place);
    viewport.addEventListener("scroll", place);
    place();
  }

  destroy(): void {
    this.host.remove();
    this.pageSheet.remove();
  }
}

export interface BarStrings {
  regionLabel: string;
  save: string;
  revert: string;
  discard: string;
  help: string;
  helpTitle: string;
  done: string;
  helpEdit: string;
  helpCancel: string;
  helpSave: string;
  helpPanel: string;
}

function button(className: string, label: string, run: () => void): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  if (className) node.className = className;
  node.textContent = label;
  node.addEventListener("click", run);
  return node;
}

function helpList(strings: BarStrings): HTMLElement {
  const wrap = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = strings.helpTitle;
  const list = document.createElement("ul");
  for (const line of [strings.helpEdit, strings.helpCancel, strings.helpSave, strings.helpPanel]) {
    const item = document.createElement("li");
    item.textContent = line;
    list.append(item);
  }
  wrap.append(title, list);
  return wrap;
}
