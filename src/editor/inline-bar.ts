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
  /** Home was tapped. The navigation is the link's own; this exists so §2.5's
      last step can end *before* the page changes, which is the only moment it
      can still write its flag. */
  home?(): void;
}

/** The one thing on this bar that goes somewhere, so it is an anchor and not a
    button with a `location` in it. §1.6 counted the links in this shadow root
    on three live sites and got zero on all three, while the help text named
    the place it would not take them, twice.

    Being a real link is the point rather than a detail: it can be opened in a
    new tab, it is draggable, a screen reader calls it a link, and a long press
    on a phone offers what a long press on a link offers. */
export interface BarHome {
  href: string;
  label: string;
}

export interface NoteAction {
  label: string;
  run(): void | Promise<unknown>;
  /** What the button says once `run` has finished — the widget's `copy`/`copied`
      pair, which is the only feedback a copy to the clipboard has. Left unset
      the button keeps its label, which is right for everything that navigates
      or takes the note down. A rejection leaves the label alone: an action that
      failed has not happened, and saying it did is worse than saying nothing. */
  done?: string;
}

/** Save, and how much of it there is.
    -------------------------------------------------------------------------
    `count` is the whole of the bar's shape: zero means there is nothing to
    save, and the button is not rendered at all rather than rendered disabled.
    §2.2 measured what a disabled Save costs on a phone — `flex: 1 1 100%` put
    it on a row of its own, 44px of a 143px bar, to offer a control that does
    nothing. `inline-bar.ts` has said "a control that does nothing is worse
    than one that is not there" about the undo buttons since 0.8.0; this is
    that rule reaching the one control it was never applied to.

    `label` and `chip` are separate because the label has to survive
    translation on a single row. "Save 1 change" is 117px in English and
    *"Enregistrer 1 modification"* does not fit at all, so the button says the
    verb and the number rides beside it — with `sentence` as what a screen
    reader hears instead, which is still the whole sentence. */
export interface SaveState {
  label: string;
  count: number;
  /** The count as this language writes it: `۲`, not `2`. */
  chip?: string;
  /** The `aria-label`: "Save 2 changes", unabbreviated. */
  sentence?: string;
  enabled: boolean;
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
  /** §2.5's step, in its own line rather than in `note`. The prototype used the
      note and the note is where an error, a conflict or a restored draft lands —
      a first run that a dropped connection can silently overwrite is not a first
      run. Same styling, so §2.2's measured 173px is unchanged by the split. */
  private readonly tourLine: HTMLParagraphElement;
  private readonly note: HTMLParagraphElement;
  private readonly help: HTMLElement;
  private readonly helpLines: { wrap: HTMLElement; list: HTMLElement };
  private readonly saveButton: HTMLButtonElement;
  private readonly saveCount: HTMLElement;
  private readonly revertButton: HTMLButtonElement;
  private readonly helpButton: HTMLButtonElement;
  private readonly exitButton: HTMLButtonElement;
  private readonly moreButton: HTMLButtonElement;
  /** One anchor, moved between the row and the sheet by `layout()` rather than
      two anchors kept in step. Two would be two hrefs to keep right, and the
      audit that counts routes out of this bar would count one affordance
      twice. */
  private readonly homeLink: HTMLAnchorElement | null;
  private readonly actions: HTMLElement;
  private readonly spacer: HTMLElement;
  /** The overflow sheet: what is not the job in hand while an owner is mid-edit
      — undo everything, how this works, Home, and the way out. */
  private readonly sheet: HTMLElement;
  private readonly sheetRows: HTMLElement[];
  /** How many changes are waiting. The bar's shape follows this and nothing
      else, so there is one place to read the answer from. */
  private pending = 0;
  private revertShown = false;
  /** Whether §2.5's last step is ringing the way to Home. Held rather than
      written straight onto a node, because which node that is changes under
      `layout()` and under the sheet opening. */
  private spotlit = false;
  /** Which control set is currently in the DOM, so a keystroke that changes
      nothing about the shape does not re-append the row — moving a focused
      button would blur it. */
  private shape = "";

  constructor(
    cssHref: string,
    strings: BarStrings,
    dir: "ltr" | "rtl",
    buttons: BarButtons,
    home?: BarHome
  ) {
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
    /* The bar's own direction, not the page's — and it has to be written here
       rather than inherited, because `:host { all: initial }` resets direction
       to `ltr` on purpose and everything inside the shadow root inherits that.
       The attribute alone would not be enough either: a UA rule loses to the
       sheet's own `.bar { direction: ltr }`, so `inline.css` carries the
       author rule that this attribute selects. */
    this.bar.setAttribute("dir", dir);
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

    this.actions = document.createElement("div");
    this.actions.className = "bar__actions";

    this.pageSheet = document.createElement("link");
    this.pageSheet.rel = "stylesheet";
    this.pageSheet.href = cssHref;
    document.head.append(this.pageSheet);

    this.revertButton = button("btn--quiet", strings.revert, buttons.revert);
    this.helpButton = button("btn--icon", strings.help, () => this.toggleHelp());
    this.helpButton.setAttribute("aria-label", strings.helpTitle);
    this.helpButton.setAttribute("aria-expanded", "false");
    this.exitButton = button("", strings.done, buttons.exit);
    this.saveButton = button("btn--primary", strings.save, buttons.save);
    /* Inside the button rather than beside it, so the count travels with the
       thing it is a count of and a thumb aiming at either hits Save. */
    this.saveCount = document.createElement("span");
    this.saveCount.className = "bar__count";
    /* The sentence in `aria-label` already carries the number, so hearing it
       twice would be the accessible version of stuttering. */
    this.saveCount.setAttribute("aria-hidden", "true");

    this.moreButton = button("btn--icon", strings.more, () => this.toggleSheet());
    this.moreButton.setAttribute("aria-label", strings.moreTitle);
    this.moreButton.setAttribute("aria-expanded", "false");
    this.moreButton.setAttribute("aria-haspopup", "true");

    this.spacer = document.createElement("span");
    this.spacer.className = "bar__spacer";

    this.homeLink = home ? anchor(home) : null;
    /* Leaving by a link the sheet is holding. If the navigation is refused —
       `beforeunload` over unsaved work — the sheet must not be left open on
       top of the page it was covering. */
    this.homeLink?.addEventListener("click", () => {
      this.closeSheet();
      /* Before the navigation rather than after it, because after it there is
         no page left to run in. §2.5's last step ends here. */
      buttons.home?.();
    });

    /* Nothing is removed from the bar by §2.2 — the rare controls move here.
       Full-width rows rather than a row of small ones: this opens on a phone,
       and the sheet is where the two irreversible-feeling things live. */
    this.sheet = document.createElement("div");
    this.sheet.className = "bar__sheet";
    this.sheet.hidden = true;
    this.sheet.setAttribute("role", "group");
    this.sheet.setAttribute("aria-label", strings.moreTitle);
    /* Held rather than appended: Home is in this list while an owner is typing
       and on the row itself at rest, and `layout()` is the one place that
       decides which. Everything else in the sheet is in it always. */
    this.sheetRows = [
      this.sheetItem(strings.discard, buttons.discard),
      this.sheetItem(strings.helpTitle, () => this.toggleHelp()),
      this.sheetItem(strings.done, buttons.exit)
    ];

    this.note = document.createElement("p");
    this.note.className = "bar__note";
    this.note.hidden = true;

    this.tourLine = document.createElement("p");
    this.tourLine.className = "bar__tour";
    this.tourLine.hidden = true;
    /* Announced when it changes — the steps advance on what the owner is doing
       rather than on a button, so somebody listening rather than looking would
       otherwise never learn that anything had. */
    this.tourLine.setAttribute("aria-live", "polite");

    this.help = document.createElement("div");
    this.help.className = "bar__help";
    this.help.hidden = true;
    this.helpLines = helpList(strings);
    this.help.append(this.helpLines.wrap);

    const main = document.createElement("div");
    main.className = "bar__main";
    main.append(this.status, this.actions);
    /* The sheet rises out of the bar rather than dropping out of it: there is
       nothing below the bar but the edge of the screen. */
    this.bar.append(this.sheet, main, this.tourLine, this.note, this.help);
    this.root.append(sheet, this.bar);
    document.body.append(this.host);

    /* Escape closes the sheet rather than leaving edit mode. The editable
       elements have their own Escape — that one reverts a field — and this
       listener never sees those, because an open sheet means the caret is not
       in the page. */
    this.bar.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.sheet.hidden) {
        event.preventDefault();
        this.closeSheet();
        this.moreButton.focus();
      }
    });

    this.layout();
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

  setSave(state: SaveState): void {
    this.saveButton.textContent = state.label;
    this.saveButton.disabled = !state.enabled;
    this.saveButton.setAttribute("aria-label", state.sentence ?? state.label);
    if (state.chip) {
      this.saveCount.textContent = state.chip;
      this.saveButton.append(this.saveCount);
    }
    this.pending = state.count;
    this.layout();
  }

  /** One more line of help, added once the page's own content model is known.

      Sections that can be turned off are the case this exists for. The
      sentence is only true of a page that has one, and a page that hasn't
      would be told about a control it does not have — so the bar is built
      before the fetch and learns this afterwards, rather than the strings
      guessing at construction. */
  addHelp(line: string): void {
    const item = document.createElement("li");
    item.textContent = line;
    this.helpLines.list.append(item);
  }

  /** The way back into §2.5's first run, in the help — because the "?" is how
      7.7's welcome notice is reopened and this is the same contract.

      Added after construction, and for `addHelp`'s reason rather than for
      convenience: a page with nothing editable on it — signed out, or simply not
      annotated — has nothing to be shown how to do, and a control that offers to
      teach an owner to tap text they cannot tap is worse than no control. The bar
      does not know which kind of page it is on until `inline.ts` has judged every
      annotation. */
  offerTour(label: string, run: () => void): void {
    this.help.append(
      button("btn--quiet", label, () => {
        this.closeHelp();
        run();
      })
    );
  }

  setRevertVisible(visible: boolean): void {
    this.revertShown = visible;
    this.layout();
  }

  /* --- which controls, and how many rows ---------------------------------- */

  /** The bar shows the controls for the state it is in, and §2.2 measured why
      it has to: the five controls of a typing bar total ~465px against 350px
      of usable width at 390. A fixed set is not a choice this bar has.

      Two sets, and the boundary between them is whether there is anything to
      save:

          at rest    [status                              ]
                     [                  ?    Home    Done ]

          typing     [Changing Eyebrow                    ]
                     [Undo this one       Save ②       ▾  ]

      Two rows either way, where 0.16.1's bar is three.

      Home is top-level at rest and inside `▾` while typing, and that placement
      is the whole of §2.3's compromise: an owner at rest is between jobs and
      may want the other surface, while an owner mid-sentence wants Save and
      nothing near it. It is still one tap from either state. */
  private layout(): void {
    const editing = this.pending > 0;
    const shape = `${editing ? "edit" : "rest"}:${this.revertShown}`;
    if (shape === this.shape) return;
    this.shape = shape;
    /* The sheet belongs to the editing set. When the last change is saved or
       undone the button holding it open has gone, so the sheet goes with it. */
    if (!editing) this.closeSheet();
    /* One anchor, two costumes: a row control beside Done, a full-width row
       inside the sheet. `replaceChildren` moves it, so it is never in both. */
    if (this.homeLink) this.homeLink.className = editing ? "bar__link btn--sheet" : "bar__link";
    this.actions.replaceChildren(
      ...(editing
        ? [
            ...(this.revertShown ? [this.revertButton] : []),
            this.spacer,
            this.saveButton,
            this.moreButton
          ]
        : [this.spacer, this.helpButton, ...(this.homeLink ? [this.homeLink] : []), this.exitButton])
    );
    const rows = [...this.sheetRows];
    /* Before *Done*, after *How this works*: the sheet reads undo, learn, go
       elsewhere, leave — and the way out stays last, where it was. */
    if (editing && this.homeLink) rows.splice(2, 0, this.homeLink);
    this.sheet.replaceChildren(...rows);
    /* Home has just moved, so the ring has to move with it. */
    this.applySpotlight();
  }

  private toggleSheet(): void {
    if (this.sheet.hidden) this.openSheet();
    else this.closeSheet();
  }

  private openSheet(): void {
    this.sheet.hidden = false;
    this.moreButton.setAttribute("aria-expanded", "true");
    this.applySpotlight();
  }

  private closeSheet(): void {
    this.sheet.hidden = true;
    this.moreButton.setAttribute("aria-expanded", "false");
    this.applySpotlight();
  }

  /** A row in the sheet. Every one of them closes it: they are all either
      one-shot actions or a surface of their own, and a sheet left open over the
      page it just changed is a second thing to dismiss. */
  private sheetItem(label: string, run: () => void): HTMLButtonElement {
    return button("btn--sheet", label, () => {
      this.closeSheet();
      run();
    });
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
      const control: HTMLButtonElement = button("btn--quiet", action.label, () => {
        const running = action.run();
        if (!action.done) return;
        void Promise.resolve(running).then(
          () => {
            control.textContent = action.done ?? action.label;
          },
          () => {
            /* Then the caller has already said so its own way — `copyMine`
               falls back to a prompt, which puts the text in front of the owner
               without this button claiming anything. */
          }
        );
      });
      this.note.append(" ", control);
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

  /* --- the first run (§2.5) --------------------------------------------- */

  /** One step of the tour, or `null` to take it down. `action` is the step's own
      way out — *Skip* on the first two, *Got it* on the last — because §2.5's
      rule is that every step is skippable and nothing here is modal. */
  setTour(text: string | null, action?: NoteAction): void {
    this.tourLine.textContent = "";
    if (text === null) {
      this.tourLine.hidden = true;
      return;
    }
    this.tourLine.append(text);
    if (action) this.tourLine.append(" ", button("btn--quiet", action.label, action.run));
    this.tourLine.hidden = false;
  }

  /** Ring the way to Home for the tour's last step, or stop.

      Which node that is depends on the bar's shape, and only the bar knows:
      §2.5 wrote step 3 as pointing at the Home control, and step 3 always
      arrives while there is something to save — which is exactly the state where
      `layout()` has moved Home into the `▾` sheet. A ring on a node inside a
      closed sheet is a ring on nothing, so it rings the route: `▾` while the
      sheet is shut, the Home row itself once it is open. */
  spotlight(on: boolean): void {
    this.spotlit = on;
    this.applySpotlight();
  }

  private applySpotlight(): void {
    this.homeLink?.removeAttribute("data-sk-tour");
    this.moreButton.removeAttribute("data-sk-tour");
    if (!this.spotlit || !this.homeLink) return;
    const hidden = this.homeLink.parentElement === this.sheet && this.sheet.hidden;
    (hidden ? this.moreButton : this.homeLink).setAttribute("data-sk-tour", "on");
  }

  private closeHelp(): void {
    this.help.hidden = true;
    this.helpButton.setAttribute("aria-expanded", "false");
  }

  private toggleHelp(): void {
    /* Opening help puts the caret down first, and this is load-bearing rather
       than tidy. Help is bounded at `min(32vh, 12rem)` (§2.2), but the bound is
       proportional: with a keyboard up the viewport is 508px and even the
       bounded help is half of it. Blurring retracts the keyboard, which makes
       that state unreachable in practice instead of merely smaller. Chrome
       blurs on a button press anyway; iOS Safari does not focus buttons on tap
       at all, which is exactly the phone this matters on. */
    if (this.help.hidden) {
      const active = document.activeElement as HTMLElement | null;
      if (active?.isContentEditable) active.blur();
    }
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
  more: string;
  moreTitle: string;
  done: string;
  helpEdit: string;
  helpCancel: string;
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

function anchor(home: BarHome): HTMLAnchorElement {
  const node = document.createElement("a");
  node.className = "bar__link";
  node.href = home.href;
  node.textContent = home.label;
  return node;
}

/* Three lines where 0.16.1 had four plus a conditional fifth, and §1.5
   measured why: help was 400px, 47.4% of a phone screen, "half the page
   disappearing behind six lines of prose, two of which point at a place the
   bar will not take them". Those two are now one line, and it names a place
   the bar can reach. What was dropped is said elsewhere at the moment it is
   true — see the note beside `inlineHelpEdit` in `strings.ts`. */
function helpList(strings: BarStrings): { wrap: HTMLElement; list: HTMLElement } {
  const wrap = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = strings.helpTitle;
  const list = document.createElement("ul");
  for (const line of [strings.helpEdit, strings.helpCancel, strings.helpPanel]) {
    const item = document.createElement("li");
    item.textContent = line;
    list.append(item);
  }
  wrap.append(title, list);
  return { wrap, list };
}
