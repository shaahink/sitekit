/* The owner's home — what they see before they touch anything.
   ---------------------------------------------------------------------------
   Until 7.7 the editor opened straight onto a form. That is fine once someone
   knows what it is and has been told a save is a commit they can undo; it is
   not fine the first time. So this sits above the picker and answers, in
   order, the three things an owner actually arrives with:

     what is this and what happens if I touch it   — the first-run panel
     did anyone come                                — their own numbers
     did my last change go live                     — their own commits

   and carries the two links that were previously sent in an email: the
   permanent analytics share link, and "ask for something bigger".

   **Everything below the first-run panel is optional and silent when absent.**
   No analytics credential means no traffic block; a repository the App cannot
   read means no change list. An owner who came to fix a typo must never meet
   an error about a subsystem they have never heard of, so nothing here throws
   and nothing here renders a failure — see 7.7's "stats must never break
   editing".

   Decision 2 of that session, kept: this is a paragraph and two links, not a
   tour. The strongest version of onboarding is that every empty state already
   reads like a person wrote it, which is why the wording sweep was budgeted
   ahead of the panel and why every string here is in strings.ts rather than
   inline. */

import { el, link } from "./dom.js";
import { fill, type EditorStrings } from "./strings.js";

export interface HomeTotals {
  pageviews: number;
  visitors: number;
}

export interface HomeWindow {
  days: number;
  current: HomeTotals;
  visitorChange: number | null;
}

export interface HomeChange {
  sha: string;
  subject: string;
  summary?: string;
  who?: string;
  at: string;
  url: string;
}

export interface HomeDeploy {
  state: "success" | "pending" | "failure" | "error" | "unknown";
  description?: string;
  url?: string;
}

export interface HomeData {
  changes?: HomeChange[];
  deploy?: HomeDeploy;
  traffic?: {
    windows?: HomeWindow[];
    pages?: Array<{ path: string; views: number }>;
  };
  shareUrl?: string;
}

/* Remembered per browser rather than per account. The alternative is another
   field in the session cookie, which would mean the reminder returns every
   time the session key is rotated — and a signed-out owner has nothing to key
   it by anyway. Dismissing it is not a preference worth a round-trip. */
const SEEN_KEY = "sk-editor-welcome-seen";

export interface HomeOptions {
  strings: EditorStrings;
  /** Fires when the owner asks for something bigger. Resolves to the issue URL
      on success, or rejects with a message worth showing. */
  onRequest: (text: string) => Promise<string>;
  /** Test seam. The panel is otherwise unmountable without a real storage. */
  storage?: Storage;
}

/** The whole block, ready to insert. Built synchronously from data that may
    still be loading — `setData` fills in the rest when it arrives, so the
    editor never waits on analytics to draw its form. */
export function home(options: HomeOptions): { element: HTMLElement; setData: (data: HomeData) => void } {
  const { strings } = options;
  const store = safeStorage(options.storage);
  const element = el("div", "sk-editor__home");

  const welcome = firstRun(strings, store);
  const help = el("button", "sk-editor__help", strings.homeHelp);
  help.type = "button";
  help.title = strings.homeHelpTitle;
  help.addEventListener("click", () => {
    welcome.hidden = false;
    /* Re-opening it deliberately does *not* clear the flag: someone reading it
       a second time has not become a first-time user again. */
  });

  const blocks = el("div", "sk-editor__blocks");
  const actions = el("p", "sk-editor__homeactions");

  element.append(welcome, help, blocks, actions);
  actions.append(requestButton(strings, options.onRequest));

  return {
    element,
    setData: (data) => {
      blocks.textContent = "";
      const traffic = trafficBlock(strings, data);
      if (traffic) blocks.append(traffic);
      const changes = changesBlock(strings, data);
      if (changes) blocks.append(changes);
      /* Appended rather than rebuilt into `actions`, so the request button
         keeps its place and any half-typed request survives the arrival of
         data it has nothing to do with. */
      const existing = actions.querySelector(".sk-editor__sharelink");
      if (existing) existing.remove();
      if (data.shareUrl) {
        const more = link(data.shareUrl, strings.homeShareLink);
        more.classList.add("sk-editor__sharelink");
        actions.append(more);
      }
    }
  };
}

/* --- what this is ------------------------------------------------------- */

function firstRun(strings: EditorStrings, store: Storage | null): HTMLElement {
  const panel = el("div", "sk-editor__welcome");
  panel.hidden = store?.getItem(SEEN_KEY) === "1";

  panel.append(el("h2", "sk-editor__welcometitle", strings.homeWelcomeTitle));
  for (const line of [strings.homeWelcomeBody, strings.homeWelcomeUndo, strings.homeWelcomeAsk]) {
    panel.append(el("p", "sk-editor__welcometext", line));
  }

  const done = el("button", "sk-editor__welcomeclose", strings.homeWelcomeClose);
  done.type = "button";
  done.addEventListener("click", () => {
    panel.hidden = true;
    try {
      store?.setItem(SEEN_KEY, "1");
    } catch {
      /* A browser refusing to remember costs a reminder next time, which is a
         great deal better than an editor that will not open. */
    }
  });
  panel.append(done);
  return panel;
}

/* --- did anyone come ---------------------------------------------------- */

function trafficBlock(strings: EditorStrings, data: HomeData): HTMLElement | null {
  const windows = data.traffic?.windows ?? [];
  if (!windows.length) return null;

  const block = el("section", "sk-editor__block");
  block.append(el("h3", "sk-editor__blocktitle", strings.homeTrafficTitle));

  /* Nobody at all is a real answer and it is the one a new site gives. Saying
     it plainly beats four zeroes, which read as a broken panel. */
  if (windows.every((window) => window.current.visitors === 0)) {
    block.append(el("p", "sk-editor__empty", strings.homeTrafficNone));
    return block;
  }

  const list = el("ul", "sk-editor__stats");
  for (const window of windows) {
    const item = el("li", "sk-editor__stat");
    item.append(
      el(
        "span",
        "sk-editor__statvalue",
        fill(strings.homeTrafficLine, {
          visitors: count(window.current.visitors, strings.visitor, strings.visitors),
          views: count(window.current.pageviews, strings.view, strings.views),
          days: String(window.days)
        })
      )
    );
    /* Null is not zero — a site going from nobody to five has not risen by 0%.
       stats.ts leaves the wording to whoever knows their reader; for an owner
       looking at their own site, the honest word is "new". */
    if (window.visitorChange !== null) {
      const change = window.visitorChange;
      const node = el(
        "span",
        `sk-editor__change sk-editor__change--${change >= 0 ? "up" : "down"}`,
        fill(strings.homeTrafficChange, { percent: `${change >= 0 ? "+" : ""}${change}` })
      );
      item.append(node);
    }
    list.append(item);
  }
  block.append(list);

  const pages = data.traffic?.pages ?? [];
  if (pages.length) {
    block.append(el("h4", "sk-editor__blocksub", strings.homePagesTitle));
    const read = el("ul", "sk-editor__pages");
    for (const page of pages) {
      read.append(
        el(
          "li",
          "sk-editor__page",
          fill(strings.homePageLine, {
            path: page.path,
            views: count(page.views, strings.view, strings.views)
          })
        )
      );
    }
    block.append(read);
  }

  return block;
}

/* --- what I changed, and did it go live --------------------------------- */

function changesBlock(strings: EditorStrings, data: HomeData): HTMLElement | null {
  const changes = data.changes ?? [];
  const block = el("section", "sk-editor__block");
  block.append(el("h3", "sk-editor__blocktitle", strings.homeChangesTitle));

  if (!changes.length) {
    /* The state a site is in on the day it launches, and the one an owner is
       most likely to see first. It should read as an invitation. */
    block.append(el("p", "sk-editor__empty", strings.homeChangesNone));
    return block;
  }

  const deploy = data.deploy;
  if (deploy && deploy.state !== "unknown") {
    const line = el("p", `sk-editor__deploy sk-editor__deploy--${deploy.state}`);
    line.append(
      document.createTextNode(
        deploy.state === "success"
          ? strings.homeDeployLive
          : deploy.state === "pending"
            ? strings.homeDeployBuilding
            : /* A failed deploy is the one case where the host's own words beat
                 anything written in advance: "Deployment rate limited — retry
                 in 24 hours" is actionable and "something went wrong" is not. */
              fill(strings.homeDeployFailed, { reason: deploy.description ?? "" })
      )
    );
    block.append(line);
  }

  const list = el("ul", "sk-editor__changes");
  for (const change of changes) {
    const item = el("li", "sk-editor__changeitem");
    item.append(el("span", "sk-editor__changetext", change.summary ?? change.subject));
    const when = el("time", "sk-editor__changewhen", relative(change.at, strings));
    if (change.at) when.dateTime = change.at;
    item.append(when);
    if (change.url) item.append(link(change.url, strings.homeChangeDetail));
    list.append(item);
  }
  block.append(list);
  return block;
}

/* --- ask for something bigger ------------------------------------------- */

function requestButton(
  strings: EditorStrings,
  onRequest: (text: string) => Promise<string>
): HTMLElement {
  const wrap = el("span", "sk-editor__request");
  const open = el("button", "sk-editor__link", strings.homeRequestOpen);
  open.type = "button";
  wrap.append(open);

  open.addEventListener("click", () => {
    if (wrap.querySelector("form")) return;
    open.hidden = true;

    const form = el("form", "sk-editor__requestform");
    const area = el("textarea", "sk-editor__input sk-editor__textarea");
    area.rows = 4;
    area.placeholder = strings.homeRequestPlaceholder;
    area.required = true;

    const send = el("button", "sk-editor__save", strings.homeRequestSend);
    send.type = "submit";
    const cancel = el("button", "sk-editor__link", strings.cancel);
    cancel.type = "button";
    const note = el("p", "sk-editor__note", strings.homeRequestNote);

    form.append(el("p", "sk-editor__label", strings.homeRequestTitle), area, note, send, cancel);
    wrap.append(form);
    area.focus();

    const close = (): void => {
      form.remove();
      open.hidden = false;
    };
    cancel.addEventListener("click", close);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = area.value.trim();
      if (!text) return;
      send.disabled = true;
      note.textContent = strings.homeRequestSending;
      void onRequest(text)
        .then((url) => {
          form.textContent = "";
          const thanks = el("p", "sk-editor__note", strings.homeRequestSent);
          form.append(thanks);
          if (url) form.append(link(url, strings.homeRequestSeeIt));
          open.hidden = false;
        })
        .catch((error: Error) => {
          send.disabled = false;
          /* The words stay in the box. A failed send that also cleared the
             textarea would be the single most annoying thing this panel could
             do, and it is exactly what a naive re-render does. */
          note.textContent = error.message || strings.homeRequestFailed;
        });
    });
  });

  return wrap;
}

/* --- small things ------------------------------------------------------- */

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "today", "yesterday", "3 days ago". Deliberately coarse: an owner wants to
    know whether this was the change they just made, not the minute of it. */
export function relative(iso: string, strings: EditorStrings, now = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const days = Math.floor((startOfDay(now) - startOfDay(at)) / 864e5);
  if (days <= 0) return strings.today;
  if (days === 1) return strings.yesterday;
  if (days < 30) return fill(strings.daysAgo, { days: String(days) });
  return new Date(at).toLocaleDateString();
}

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Storage that a browser may refuse to give. Safari in private mode throws on
    access rather than returning null, and an editor that will not open because
    it could not remember a dismissed panel would be an absurd way to fail. */
function safeStorage(provided?: Storage): Storage | null {
  if (provided) return provided;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
