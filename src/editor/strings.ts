/* Every word the panel says.
   ---------------------------------------------------------------------------
   Collected in one object so a site can translate the editor without owning a
   copy of it — `mountEditor(root, { strings: { save: "Enregistrer" } })`. The
   defaults are English and deliberately impersonal: the kit serves four sites
   and knows nothing about any of them, so nothing here names a studio, an
   owner or a site.

   `{name}` placeholders are filled by `fill()`. */

export interface EditorStrings {
  loading: string;
  /** Shown when the site has no Google client configured yet. */
  notConfigured: string;
  startFailed: string;

  signInTitle: string;
  signInNote: string;
  signInUnavailable: string;
  signInFailed: string;
  gisFailed: string;
  signOut: string;

  /** The collection picker's label. */
  editing: string;
  /** `{path}` — which file is open. */
  editingFile: string;
  emptyList: string;
  optional: string;

  /* --- rows in a list ---------------------------------------------------- */

  /** `{label}` — the row's own singular name, so it reads "Add a slide". */
  rowAdd: string;
  rowUp: string;
  rowDown: string;
  rowRemove: string;
  /** The same button after one tap. Removing a row is the one thing here that
      cannot be undone by typing the old value back. */
  rowRemoveConfirm: string;

  /* --- photographs -------------------------------------------------------- */

  imageChoose: string;
  imageReplace: string;
  /** Shown while a phone photograph is being scaled, which is seconds rather
      than instant. Silence here is what makes an owner tap twice. */
  imageWorking: string;
  /** `{width}` `{height}` `{size}` — what is about to be committed, in kB. */
  imageReady: string;
  imageTooBig: string;
  imageWrongType: string;
  imageUnreadable: string;
  /** The folded-away box that re-points an image at a file already on the
      site. The panel could always do this and it stays possible. */
  imagePointAt: string;
  /** Holding Save until a new photograph has been described. The schema
      defaults `alt` to "", so nothing else will ever ask. */
  imageNeedsAlt: string;

  save: string;
  /** `{count}` — "Save 2 changes". */
  saveCount: string;
  change: string;
  changes: string;
  saving: string;
  saved: string;
  savedNote: string;
  savedLink: string;

  loadFailed: string;
  saveFailed: string;
  invalid: string;
  conflict: string;
  reload: string;
  /** A save refused because the sign-in lapsed. Distinct from every other
      failure, because it is the only one where the owner's work is safe and
      the fix is one tap. */
  expired: string;
  expiredLink: string;
  /** The panel's way onto the page an entry is showing — the only route to
      inline editing that does not involve typing a query string. */
  openPage: string;
  /** Offered on the panel when the owner arrived from a page. */
  backToPage: string;

  /* --- sections that can be turned off ----------------------------------- */

  /** Beside a section's switch. Says what turning it off *does*, which
      "Visible" does not. */
  sectionShow: string;
  /** Under a switch that is off. Has to carry both halves: it is not on the
      public site, and nothing has been deleted — plus the one thing an owner
      cannot work out alone, which is that a section that is off is not on the
      page, so the page is not where it gets turned back on. */
  sectionHidden: string;

  /* --- inline editing, on the site's own pages --------------------------- */

  /** The bar's resting line: what to do, before anything has been touched. */
  inlineIdle: string;
  /** `{what}` — the field's own label, e.g. "Editing Tagline". */
  inlineFocused: string;
  /** `{count}` — "2 changes not saved yet". */
  inlinePending: string;
  /** Shown when the page carries no annotations at all. */
  inlineNothing: string;
  /** Not signed in: inline editing never talks to Google itself. */
  inlineSignIn: string;
  inlineSignInLink: string;
  inlineDone: string;
  inlineRevert: string;
  inlineDiscard: string;
  inlineHelp: string;
  inlineHelpTitle: string;
  inlineHelpEdit: string;
  inlineHelpCancel: string;
  inlineHelpSave: string;
  inlineHelpPanel: string;
  /** Only added to the help when the page has a section that can be turned
      off, because it is only true of such a page. */
  inlineHelpHidden: string;
  /** `{label}` — a field whose *value* carries markup, or whose element wraps
      other elements the design depends on. "Formatting" is the honest word for
      both from where the owner is standing. */
  inlinePanelOnly: string;
  /** `{label}` — a field the panel has to handle for a reason that has nothing
      to do with formatting: it is decorative, or inside a control that does
      something else when tapped. Saying "formatting" here would be a lie the
      owner could act on. */
  inlinePanelElsewhere: string;
  inlinePanelLink: string;
  /** `{path}` — an annotation the content no longer has a value for. Shown on
      the element itself, where the path is the useful thing to say. */
  inlineBroken: string;
  /** The same problem summarised in the bar, where a path would mean nothing
      to the owner reading it — the red marks say which, and the console names
      them for whoever fixes it. */
  inlineBrokenSome: string;
  /** `{count}` — a restored draft. */
  inlineDraftFound: string;
  inlineDraftRestore: string;
  inlineDraftDiscard: string;
  inlineDraftStale: string;
  inlineLeaveWarning: string;

  /* --- the owner's home (7.7) -------------------------------------------- */

  /** The first-run panel. Three sentences and a button, not a tour: what this
      is, that nothing is permanent, and where to ask for something bigger.
      Written to be read once by someone who has never seen an editor and does
      not want to learn one. */
  homeWelcomeTitle: string;
  homeWelcomeBody: string;
  homeWelcomeUndo: string;
  homeWelcomeAsk: string;
  homeWelcomeClose: string;
  /** The "?" that brings it back. */
  homeHelp: string;
  homeHelpTitle: string;

  homeTrafficTitle: string;
  /** `{visitors}` `{views}` `{days}` — already pluralised by the caller. */
  homeTrafficLine: string;
  /** `{percent}` — carries its own sign. */
  homeTrafficChange: string;
  homeTrafficNone: string;
  homePagesTitle: string;
  /** `{path}` `{views}`. */
  homePageLine: string;
  homeShareLink: string;

  homeChangesTitle: string;
  homeChangesNone: string;
  homeChangeDetail: string;
  homeDeployLive: string;
  homeDeployBuilding: string;
  /** `{reason}` — the host's own words, which beat anything written here. */
  homeDeployFailed: string;

  homeRequestOpen: string;
  homeRequestTitle: string;
  homeRequestPlaceholder: string;
  homeRequestNote: string;
  homeRequestSend: string;
  homeRequestSending: string;
  homeRequestSent: string;
  homeRequestSeeIt: string;
  homeRequestFailed: string;

  cancel: string;
  visitor: string;
  visitors: string;
  view: string;
  views: string;
  today: string;
  yesterday: string;
  /** `{days}`. */
  daysAgo: string;
}

export const defaultStrings: EditorStrings = {
  loading: "Loading…",
  notConfigured:
    "The editor isn't configured for this site yet. Nothing is wrong with the site itself.",
  startFailed: "The editor couldn't start.",

  signInTitle: "Sign in to edit",
  signInNote: "Use the Google account this site was set up with. Nothing else can get in.",
  signInUnavailable:
    "Sign-in isn't set up for this site yet — the Google client hasn't been created. " +
    "Nothing is broken; there is just nothing to sign in to.",
  signInFailed: "That sign-in didn't work.",
  gisFailed: "Google's sign-in script didn't load.",
  signOut: "Sign out",

  editing: "Editing",
  editingFile: "Editing {path}",
  emptyList: "Nothing here yet.",
  optional: "optional",

  rowAdd: "Add {label}",
  rowUp: "Move up",
  rowDown: "Move down",
  rowRemove: "Remove",
  rowRemoveConfirm: "Tap again to remove",

  imageChoose: "Choose a photograph",
  imageReplace: "Replace this photograph",
  imageWorking: "Getting the photograph ready…",
  imageReady: "Ready — {width}×{height}, {size} kB. It goes on the site when you save.",
  imageTooBig: "That photograph is too large even after shrinking. Try a smaller one.",
  imageWrongType: "This browser didn't produce a JPEG. Try a different photograph, or the full editor on a computer.",
  imageUnreadable: "That file couldn't be read as a photograph.",
  imagePointAt: "Or use a picture already on the site",
  imageNeedsAlt: "Please describe the new photograph first — it's what people using a screen reader will hear.",

  save: "Save",
  saveCount: "Save {count}",
  change: "change",
  changes: "changes",
  saving: "Saving…",
  saved: "Saved",
  savedNote: "Saved. The site rebuilds in a minute or so — ",
  savedLink: "see the change",

  loadFailed: "Couldn't load that content.",
  saveFailed: "Couldn't save that change.",
  invalid: "That change doesn't fit the content model.",
  conflict: "Someone else edited this since you opened it — reload and try again.",
  reload: "Reload",
  /* Says the two things that matter in the order they matter: the work is
     safe, and this is not something they broke. */
  expired: "You were signed out while you were working. Nothing you typed is lost —",
  expiredLink: "sign in again",
  openPage: "Edit this page on the site",
  backToPage: "Back to the page",

  sectionShow: "Show this section on the site",
  sectionHidden:
    "This section isn't on the site at the moment. Nothing has been deleted — everything you've written is still here, " +
    "and this switch is where it comes back. It won't be on the page itself while it's off.",

  /* Written to be read by someone who has never seen a CMS. Nothing here says
     "field", "commit", "deploy" or "collection"; an owner is changing the
     words on their own page and everything else is our problem. */
  inlineIdle: "Tap any highlighted text to change it.",
  inlineFocused: "Changing {what}",
  inlinePending: "{count} not saved yet.",
  inlineNothing: "Nothing on this page can be edited here yet — try the full editor.",
  inlineSignIn: "Sign in first, then come back to this page.",
  inlineSignInLink: "Sign in",
  inlineDone: "Done",
  inlineRevert: "Undo this one",
  inlineDiscard: "Undo everything",
  inlineHelp: "?",
  inlineHelpTitle: "How this works",
  inlineHelpEdit: "Tap highlighted text and type. Nothing is public until you press Save.",
  inlineHelpCancel: "Press Escape, or “Undo this one”, to put a piece of text back as it was.",
  inlineHelpSave: "Save sends everything you changed at once. The page updates a minute or so later.",
  inlineHelpPanel: "Greyed-out text has to be changed in the full editor.",
  inlineHelpHidden:
    "Whole sections can be turned off in the full editor. One that's off isn't on this page at all, so that's also where it comes back.",
  inlinePanelOnly: "“{label}” has formatting in it, so it's edited in the full editor.",
  inlinePanelElsewhere: "“{label}” is edited in the full editor, not here on the page.",
  inlinePanelLink: "Open the full editor",
  inlineBroken: "This points at “{path}”, which the content no longer has.",
  inlineBrokenSome:
    "Some text on this page (marked red) points at content that no longer exists. That's a fault in the page, not in anything you did — everything else here still works.",
  /* Phrased so the count carries its own verb: "1 change" and "2 changes" both
     have to fit, and "…that were never saved" is wrong for one of them. */
  inlineDraftFound: "You left {count} here unsaved.",
  inlineDraftRestore: "Restore",
  inlineDraftDiscard: "Discard",
  inlineDraftStale:
    "You had unsaved changes here, but the page has been edited somewhere else since. They've been dropped rather than written over that.",
  inlineLeaveWarning: "You have changes that haven't been saved yet.",

  /* --- the owner's home -------------------------------------------------- */

  /* Voice, and it is the whole of Decision 2: say what this is, say that
     nothing is permanent, say where to ask for more, get out of the way. No
     welcome tour, no exclamation marks, and no word that assumes the reader
     has ever seen a content management system — "published", "deploy",
     "commit" and "repository" are all absent on purpose. */
  homeWelcomeTitle: "This is where you change your site",
  homeWelcomeBody:
    "Everything you type here goes onto your real website, usually within a minute or two. You can also tap the words on your own pages and type over them.",
  homeWelcomeUndo:
    "Nothing you do here is permanent. Every change is kept, so anything can be put back the way it was — just ask.",
  homeWelcomeAsk:
    "For anything bigger than words and pictures — a new section, a different layout — use “Ask for a change” below and describe what you want.",
  homeWelcomeClose: "Got it",
  homeHelp: "?",
  homeHelpTitle: "What is this?",

  homeTrafficTitle: "Did anyone come?",
  homeTrafficLine: "{visitors} and {views} in the last {days} days",
  homeTrafficChange: "{percent}% on the {days} days before",
  /* A new site's honest answer, and it should not read like a fault. */
  homeTrafficNone: "Nobody yet. That's normal for a site that's just gone up.",
  homePagesTitle: "Most read",
  homePageLine: "{path} — {views}",
  homeShareLink: "See all your visitor numbers",

  homeChangesTitle: "What you changed",
  homeChangesNone: "Nothing changed yet. Pick a page below and try something — you can always put it back.",
  homeChangeDetail: "See exactly what changed",
  homeDeployLive: "Your last change is on the site.",
  homeDeployBuilding: "Your last change is going up now — give it a minute, then reload your site.",
  /* The host's own sentence, quoted. "Deployment rate limited — retry in 24
     hours" tells somebody what to do; "something went wrong" does not. */
  homeDeployFailed: "Your last change hasn't gone up yet: {reason}",

  homeRequestOpen: "Ask for a change",
  homeRequestTitle: "What would you like changed?",
  homeRequestPlaceholder: "A new section for workshops, with three photographs and a paragraph…",
  homeRequestNote: "This goes straight to Shahin. Describe it however you like.",
  homeRequestSend: "Send",
  homeRequestSending: "Sending…",
  homeRequestSent: "Sent. You'll hear back.",
  homeRequestSeeIt: "Follow it here",
  homeRequestFailed: "Couldn't send that just now. Your words are still here — try again in a moment.",

  cancel: "Cancel",
  visitor: "visitor",
  visitors: "visitors",
  view: "view",
  views: "views",
  today: "today",
  yesterday: "yesterday",
  daysAgo: "{days} days ago"
};

/** `fill("Editing {path}", { path: "home.yaml" })`. Absent keys are left as
    they are, so a half-translated string still reads as a template rather
    than as an empty gap. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = values[key];
    return value === undefined ? whole : String(value);
  });
}
