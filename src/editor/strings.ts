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
  reload: "Reload"
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
