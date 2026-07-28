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
  inlineLeaveWarning: "You have changes that haven't been saved yet."
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
