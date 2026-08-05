/* Every word the panel says.
   ---------------------------------------------------------------------------
   Collected in one object so a site can translate the editor without owning a
   copy of it — `mountEditor(root, { strings: { save: "Enregistrer" } })`. The
   defaults are English and deliberately impersonal: the kit serves four sites
   and knows nothing about any of them, so nothing here names a studio, an
   owner or a site.

   Three tables since 0.17.0, and the reason is a measurement rather than a
   principle. Session 17's audit drove the editor on nimagiti's Farsi page and
   on elfine's French one: both said *"Tap any highlighted text to change it."*
   The editor was English on all six sites, including the two whose owners do
   not read English, and it stayed that way because a site *could* translate it
   a word at a time and no site reasonably would. A table here is the same work
   once. The mechanism is the widget's, unchanged — `stringsFor` and
   `editorStrings` are `src/widget/strings.ts`'s two functions with a different
   table behind them — because two surfaces in this kit ask a site for words
   and they should ask the same way.

   The register of each table is that language's own site: French follows
   elfine's `vous`, Farsi follows nimagiti's informal, direct second person.
   Neither is a translation of the English word by word; both say what the
   English sentence says.

   `{name}` placeholders are filled by `fill()`. */

export interface EditorStrings {
  loading: string;
  /** Shown when the site has no Google client configured yet. */
  notConfigured: string;
  startFailed: string;

  signInTitle: string;
  /** The one sentence before sign-in. §1.3 measured first arrival as two
      sentences and Google's button, with every word of reassurance behind the
      sign-in it was meant to make safe — so this says what the page is and that
      nothing done on it is permanent, to whoever opens it. The URL is public and
      this sentence is not a secret; the alternative is telling people only after
      they have committed. */
  signInWhat: string;
  signInNote: string;
  signInUnavailable: string;
  signInFailed: string;
  gisFailed: string;
  signOut: string;

  /* --- the fleet hand-off (0.19.0, session 22) --------------------------- */

  /** The button that starts the hand-off. It says Google because that is what
      the owner will see when they get there, and a button that named our own
      sign-in page would be asking them to trust a second brand on the way to
      the one they already know. */
  signInHandoff: string;
  /** What pressing it does, said before it happens: an owner who is bounced to
      another host without warning has been given a reason to stop. */
  signInHandoffNote: string;
  /** Decision 5, the case that must not fail silently: the site is fine, the
      sign-in origin is not answering, and only that origin can let them in. */
  signInHandoffDown: string;
  /** Between the hand-off and Google's own button, where a site has both. */
  signInOther: string;
  /** The callback's refusal, said on the site the owner came back to. The POST
      path can put this in a response body; a redirect cannot, so the editor
      reads `?sk_auth=denied` and says it here. */
  signInDenied: string;
  /** Signing in again after a session lapsed mid-edit, where the only way in
      is a hand-off — which is a navigation, and a navigation loses what they
      typed. Warned rather than discovered. */
  signInLapsedAway: string;

  /* --- finding a word (0.20.0, session 21 §A3) ---------------------------- */

  /** The search field's own label. A3.1 said *this page*, because that was
      honestly all it reached; A3.2 gave it the other twenty, so it says the
      site. What a search reaches is the thing an owner has to know before they
      trust its answer, which is why this label has ever mentioned scope at
      all. */
  searchLabel: string;
  /** `{count}` — already pluralised and already in the panel's own digits. */
  searchCount: string;
  searchMatch: string;
  searchMatches: string;
  /** No match on the page in front of them. Said plainly: an empty list under
      a field an owner has just typed into reads as a fault in the editor
      rather than an answer. */
  searchNothing: string;
  /** Under a list that stopped at its cap. A list of twenty claiming
      twenty-three matches has hidden three of them and said nothing, which is
      the one thing a search must not do. */
  searchNarrow: string;

  /* The other pages. A separate list under the first one, because it arrives
     about a second later — measured: 697ms cold, ~250ms on a warm instance —
     and nothing that slow may sit in front of the half that is instant. */

  /** While the server is being asked. Without it the panel goes quiet for a
      second under a list that has already answered, which reads as "that is
      all there is". */
  searchLooking: string;
  /** `{count}` on the owner's other pages. */
  searchElsewhere: string;
  /** Nothing anywhere else. Distinct from `searchNothing` so the two lists
      each answer for themselves. */
  searchElsewhereNothing: string;
  /** The look failed. Named rather than swallowed: an owner told "nothing on
      your other pages" when the truth is "we could not look" stops looking,
      and being quietly wrong about an absence is the one thing this feature
      cannot afford. */
  searchElsewhereFailed: string;

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
  /** The site answered, and its trouble is its own: a 5xx, or a status nothing
      here recognises. Pressing Save again is a reasonable thing to do, which is
      what separates this from `saveRefused` — and until 0.17.0 this sentence
      was said to a 403 and a 500 alike (§2.6, F6). */
  saveFailed: string;
  /** A save that never reached the site at all — a dropped connection, a phone
      that lost its signal mid-tap. Distinct from every other failure because
      the server never had an opinion, so the only useful sentence is about
      where the owner's words are and what not to do next. Measured: without
      this the button read "Saving…" and stayed disabled forever. */
  saveUnreachable: string;
  /** A save the site *refused*: any 4xx that is not 401, 409 or a field-level
      complaint — a wrong origin, an account off the allowlist, a collection
      that no longer exists. Three things in one sentence, because they are the
      three an owner needs: nothing is lost, trying again will not help, and
      here is who to ask. The server's own words are English and terse ("Bad
      origin."), so they go to the console for whoever is diagnosing rather than
      at an owner reading Farsi. */
  saveRefused: string;
  invalid: string;
  conflict: string;
  reload: string;
  /** Beside Reload on a conflict, and *before* it: reloading is the only safe
      way out and it drops what the owner typed, so the way to keep their words
      has to be offered first. The widget's `copy`/`copied` pair is the
      precedent — same idea, same fallback to `window.prompt` where the
      clipboard is refused. */
  copyMine: string;
  /** The same button after one tap. */
  copiedMine: string;
  /** `{what}` — a required field the owner has just emptied. Holds Save the way
      `imageNeedsAlt` does, and for the same reason: the schema defaults a
      string to "" and will accept the commit happily, so this is the only place
      it is ever asked. Said only of a field *this session* emptied — a value
      that was already blank when the panel opened is not something to lock an
      owner out of saving over. */
  fieldNeeded: string;
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
  /** In a collapsed section's summary, beside its switch, when the switch is
      off. One word, because it shares a row with the section's own name — and
      the sentence explaining what "off" means is inside the box, where an owner
      who opened it is asking. */
  sectionOff: string;

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
  /** The overflow affordance, as a glyph — the counterpart of `inlineHelp`'s
      "?" and hidden from a screen reader the same way, by `inlineMoreTitle`.
      A fixed control set does not fit 390px in three languages (§2.2), so the
      rare controls live behind this while an owner is mid-edit. */
  inlineMore: string;
  /** What the overflow button is called. The widget's own word for the same
      idea, so the two surfaces this kit ships do not invent two. */
  inlineMoreTitle: string;
  /** The bar's way to the panel, and the panel's own name from the page.
      "Home" rather than "the full editor": 7.7 made the panel the place an
      owner arrives — what this is, who visited, what changed — and a place has
      a name. §1.6 counted zero routes to it from the bar on all three sites
      while the help text promised one twice. */
  inlineHome: string;
  inlineHelpEdit: string;
  inlineHelpCancel: string;
  /** Names Home, and this is the line the whole of §2.3 exists to make
      truthful: it used to say "the full editor" from a bar with no way to
      reach one. */
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
  /** Both surfaces since 0.17.0, and it kept the `inline` prefix because
      renaming a key a site may have overridden would cost more than the tidiness
      is worth. Bug #17: the panel had no `beforeunload` guard at all, so typing
      into the form and following a link lost the work in silence — the one
      surface where that matters most, because the panel has no draft on disk to
      come back to. */
  inlineLeaveWarning: string;

  /* --- the first run, on the owner's own page (§2.5) --------------------- */

  /** Step 1, advanced by an annotated element taking focus. */
  tourStep1: string;
  /** Step 2, advanced by the field going dirty. It is about Save, which §2.2
      does not render until there is something to save — so this sentence and
      the button appearing are the same event. */
  tourStep2: string;
  /** Step 3, and the last. It names Home rather than pointing at it: §2.5 wrote
      "This is Home", and building it measured that step 3 always arrives while
      the bar is dirty, where Home is inside the `▾` sheet rather than on the
      row (`inline-bar.ts`, `layout`). The ring shows where; the words say what,
      and stay true whichever shape the bar is in. */
  tourStep3: string;
  /** Every step is skippable — nothing here is modal and nothing waits. */
  tourSkip: string;
  /** The last step's own ending, beside tapping the thing it is about. */
  tourDone: string;
  /** In the bar's help: the "?" is how the tour is reopened, which is 7.7's
      contract for its welcome notice and the same one here. Reopening does not
      clear the flag. */
  inlineHelpTourAgain: string;

  /* --- the way in, on the owner's own page (0.20.0, session 24) ---------- */

  /** The whole of the affordance a marked device is shown, and it says what
      tapping it does rather than naming the tool: an owner is standing on the
      page, and "this page" is the thing they can see. */
  hintEdit: string;
  /** The glyph, hidden from a screen reader by `hintDismissTitle` the way
      `inlineMore` is by `inlineMoreTitle`. */
  hintDismiss: string;
  /** What dismissing means, said exactly: the device forgets, so this is not
      "hide for now". On a shared family device that is the honest offer, and
      it is undone by signing in and editing again rather than by a setting. */
  hintDismissTitle: string;

  /* --- the other language of this page (0.20.0, session 23 gap 2) --------- */

  /** The lead-in to one button per other language of the page on screen.
      Absent from the panel entirely on a site whose entries have no locale in
      their ids, which is five of the seven — see siblings.ts.

      It names the *other* language rather than the current one because the
      picker above it already says which page is open, and because the mistake
      this exists to prevent is not knowing that the other one is there. */
  siblingLabel: string;
  /** `{label}` — the site's own word for that language, out of its
      `entryLabels`. Not the kit's: "Français" is what elfine's schema says and
      what her picker says, and an editor inventing its own name for her page
      would be one more thing that has to agree. */
  siblingTitle: string;

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
  /** The notice's one primary action: onto the owner's own page, in edit mode,
      with the tour armed. Absent where the site has declared no `entryUrl` for
      the entry on screen — the same rule `openPage` follows, and for the same
      reason: an offer that cannot be kept is worse than no offer. */
  homeWelcomeShowMe: string;
  /** The "?" that brings it back. */
  homeHelp: string;
  homeHelpTitle: string;

  homeTrafficTitle: string;
  /** `{visitors}` `{views}` `{days}` — already pluralised by the caller. */
  homeTrafficLine: string;
  /** `{percent}` — carries its own sign — and `{days}`, the window it is
      against. Both are required: a missing key leaves its own braces in the
      sentence, which is what an owner read for half of 0.14.0's life. */
  homeTrafficChange: string;
  homeTrafficNone: string;
  homePagesTitle: string;
  /** `{path}` `{views}`. */
  homePageLine: string;
  homeShareLink: string;

  homeChangesTitle: string;
  homeChangesNone: string;
  /** When the change list could not be read at all — distinct from an empty
      one, which is an invitation. Said out loud because the alternative is
      telling an owner with a year of history that nothing has ever changed. */
  homeChangesUnavailable: string;
  homeChangeDetail: string;

  /* --- putting a change back (0.20.0, session 23 gap 1) ------------------- */

  /** The control on every row of the change list.

      **Not "undo" and not "revert", and that is a constraint rather than a
      preference.** `inline-bar.ts` already owns both words on this same
      surface, for the *unsaved* field-level case — `revert`, `inlineRevert`,
      "Undo this one", "undo everything". A saved change put back is a
      different action with a different blast radius, and two very different
      things behind one word is how an owner learns to distrust both. So this
      is said from their side: the thing goes back to how it was. */
  homeRestore: string;
  /** Asked before it happens, because it writes to a live site and the write
      is the production rebuild — and unlike Save there is nothing typed whose
      loss would warn anybody.

      **It carries no count, deliberately.** How many pages a change touched is
      only known after the server has compared two commits, and asking for that
      before the owner has said yes would be a round trip to decorate a
      question they may answer no to. The count is in `homeRestoreDone`, where
      it is measured rather than guessed. */
  homeRestoreConfirm: string;
  /** The confirming button. It repeats the verb rather than saying "Yes",
      which is the difference between reading the question and not. */
  homeRestoreYes: string;
  homeRestoreBusy: string;
  /** Said once for the whole list, because after one restore every other row
      in it is describing a state the site is no longer in. `{files}` — how
      many pages actually moved, counted by the server and pluralised through
      `plural()`, so a Farsi owner reads it in Persian digits like everything
      else they are counted. */
  homeRestoreDone: string;
  /** Pressing it on a change whose content effect is already gone. Not a
      failure: nothing was committed, so nothing was deployed. */
  homeRestoreNothing: string;
  /** The fallback when the server said nothing readable. Every other refusal
      is the server's own sentence, shown verbatim — it knows which of the five
      reasons applied and this does not. */
  homeRestoreFailed: string;
  /** The noun `homeRestoreDone`'s `{files}` is counted in. */
  page: string;
  pages: string;

  /** `{who}` — the person the editor recorded on the commit. */
  homeChangeBy: string;
  /** For a commit with no editor attribution, which means it was not an owner's
      edit at all. */
  homeChangeByUs: string;
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

  /* --- settings, the app, and this device (0.23.0) ----------------------- */

  /** The bar's one new control. It replaces "Sign out" there rather than
      joining it: session 17 measured this bar taking a quarter of a phone
      screen, and the way to add six things to it is to add one. */
  accountOpen: string;
  accountTitle: string;
  accountClose: string;
  /** `{who}`. */
  accountWho: string;

  deviceTitle: string;
  /** A laptop with no sensor. Said rather than left blank, because a missing
      row and a broken row look identical. */
  deviceUnsupported: string;
  deviceOffer: string;
  deviceEnrol: string;
  deviceEnrolled: string;
  deviceReady: string;
  deviceForget: string;
  deviceForgotten: string;

  /** The sign-in screen's button, and the sentence shown instead of it when
      this device could do it but nobody has signed in yet. That sentence is
      the reason this whole group exists: it is what should have been on screen
      the day somebody pressed a dead button and told us nothing happened. */
  deviceUnlock: string;
  deviceNeedsSession: string;

  /* Every refusal `app/passkey.ts` can return, except `cancelled`, which is
     the reader's own decision and gets no message at all. */
  deviceFailedNotConfigured: string;
  deviceFailedUnauthorized: string;
  deviceFailedNotEnrolled: string;
  deviceFailedRefused: string;
  deviceFailedTooOld: string;
  deviceFailedUnverified: string;
  deviceFailedRevoked: string;
  deviceFailedOffline: string;
  deviceFailedUnknown: string;

  installTitle: string;
  installNote: string;
  installButton: string;
  installDone: string;
  /** Safari has no install API and never will, so the only honest thing to
      show an iPhone is where its own button is. */
  installIos: string;
  installLater: string;

  languageTitle: string;

  helpTitle: string;
  helpTour: string;
  helpAsk: string;

  /** `{version}`. Which release an owner is looking at, because "the save
      button did nothing" is unanswerable without it. */
  versionLabel: string;

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
  signInWhat:
    "This is where you change the words and pictures on your own site. Nothing you do here is permanent — every change is kept, and anything can be put back.",
  signInNote: "Use the Google account this site was set up with. Nothing else can get in.",
  signInUnavailable:
    "Sign-in isn't set up for this site yet — the Google client hasn't been created. " +
    "Nothing is broken; there is just nothing to sign in to.",
  signInFailed: "That sign-in didn't work.",
  gisFailed: "Google's sign-in script didn't load.",
  signOut: "Sign out",

  signInHandoff: "Sign in with Google",
  signInHandoffNote:
    "You'll sign in on our sign-in page, and come straight back here afterwards.",
  signInHandoffDown:
    "Our sign-in page isn't answering at the moment. Nothing is wrong with your site — " +
    "please try again in a few minutes.",
  signInOther: "Trouble? Sign in with Google directly",
  signInDenied: "That account can't edit this site.",
  signInLapsedAway:
    "Signing in again means leaving this page. Copy anything you've typed before you go.",

  searchLabel: "Find a word anywhere on your site",
  searchCount: "{count} on this page",
  searchMatch: "match",
  searchMatches: "matches",
  searchNothing: "Nothing on this page has those words in it.",
  searchNarrow: "Type a bit more to narrow this down.",
  searchLooking: "Looking through your other pages…",
  searchElsewhere: "{count} on your other pages",
  searchElsewhereNothing: "Nothing on your other pages either.",
  searchElsewhereFailed: "Couldn't look through your other pages just now.",

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
  saveUnreachable:
    "Couldn't reach the site to save that. Everything you typed is still here — check your connection and press Save again. Don't reload this page yet.",
  saveRefused:
    "The site wouldn't accept that change. Nothing you typed is lost, but pressing Save again won't help — " +
    "send this page to whoever set your site up and they can tell you why.",
  invalid: "That change doesn't fit the content model.",
  conflict:
    "Someone else changed this page since you opened it. Copy your words first if you want to keep them — " +
    "reloading brings in their version and drops yours.",
  reload: "Reload",
  copyMine: "Copy my text",
  copiedMine: "Copied",
  fieldNeeded: "“{what}” can't be left empty — put something in it, and Save comes back.",
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
  sectionOff: "Off",

  /* Written to be read by someone who has never seen a CMS. Nothing here says
     "field", "commit", "deploy" or "collection"; an owner is changing the
     words on their own page and everything else is our problem. */
  inlineIdle: "Tap any highlighted text to change it.",
  inlineFocused: "Changing {what}",
  inlinePending: "{count} not saved yet.",
  inlineNothing: "Nothing on this page can be edited here yet — try Home.",
  inlineSignIn: "Sign in first, then come back to this page.",
  inlineSignInLink: "Sign in",
  inlineDone: "Done",
  inlineRevert: "Undo this one",
  inlineDiscard: "Undo everything",
  inlineHelp: "?",
  inlineHelpTitle: "How this works",
  inlineMore: "▾",
  inlineMoreTitle: "More",
  inlineHome: "Home",
  /* Three lines where 0.16.1 had five, and every sentence that went is said
     somewhere an owner meets it at the moment it is true. "Save sends
     everything at once" is what the count on the button already shows; "the
     page updates a minute or so later" is `savedNote`, said after a save
     rather than before one. What is left is the two things the bar can be
     asked at any moment and the one place everything else lives. */
  inlineHelpEdit:
    "Tap highlighted text and type. Save appears as soon as you change something, and nothing is public until you press it.",
  inlineHelpCancel: "Press Escape, or “Undo this one”, to put a piece of text back as it was.",
  inlineHelpPanel: "Greyed-out text, your visitors, and everything else are in Home.",
  inlineHelpHidden: "Whole sections can be turned on and off in Home too — a section that's off isn't on this page at all.",
  inlinePanelOnly: "“{label}” has formatting in it, so it's changed in Home.",
  inlinePanelElsewhere: "“{label}” is changed in Home, not here on the page.",
  inlinePanelLink: "Open Home",
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

  /* Three sentences, and the first two are instructions an owner carries out
     rather than remembers. Nothing here says "field", "annotation" or "commit",
     and step 2 makes the one promise that matters before somebody types into
     their own home page for the first time. */
  tourStep1: "This text is yours — tap the highlighted words to change them.",
  tourStep2: "Type over it. Save makes it real — nothing is public until you press Save.",
  tourStep3: "Home has your visitors, what you've changed, and where to ask for something bigger.",
  tourSkip: "Skip",
  tourDone: "Got it",
  inlineHelpTourAgain: "Show me how again",

  hintEdit: "Edit this page",
  hintDismiss: "×",
  hintDismissTitle: "Don't offer this on this device",

  siblingLabel: "This page is also in:",
  siblingTitle: "Open this page in {label}",

  /* --- the owner's home -------------------------------------------------- */

  /* Voice, and it is the whole of Decision 2: say what this is, say that
     nothing is permanent, say where to ask for more, get out of the way. No
     welcome tour, no exclamation marks, and no word that assumes the reader
     has ever seen a content management system — "published", "deploy",
     "commit" and "repository" are all absent on purpose. */
  homeWelcomeTitle: "This is where you change your site",
  homeWelcomeBody:
    "Everything you type here goes onto your real website, usually within a minute or two. You can also tap the words on your own pages and type over them.",
  /* Corrected in 0.20.0, and the correction is the point. This sentence said
     "anything can be put back the way it was — just ask" on the first screen
     of every site in three languages, and session 23 measured what was behind
     it: zero controls that could put anything back. The promise was kept by a
     person, per owner, forever. Now the list below carries the control, and
     the sentence says where it is; "just ask" survives for what the list does
     not reach, which is anything older than five changes. */
  homeWelcomeUndo:
    "Nothing you do here is permanent. Every change below has a “Put this back” next to it, and anything older can be put back too — just ask.",
  homeWelcomeAsk:
    "For anything bigger than words and pictures — a new section, a different layout — use “Ask for a change” below and describe what you want.",
  homeWelcomeClose: "Got it",
  homeWelcomeShowMe: "Show me how",
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

  /* Not "What you changed". The list is filtered by content path and not by
     author, so it carries our commits too — the browser pass found Elfine's
     newest row saying "Stop Elfine's site telling people not to work with her",
     which she did not write and did not do. Every row says whose it was now, and
     the heading no longer claims they are all the reader's. */
  homeChangesTitle: "What changed",
  homeChangesNone: "Nothing changed yet. Pick a page below and try something — you can always put it back.",
  homeChangesUnavailable:
    "Couldn't read your recent changes just now. Your site is fine and so are your words — this list should be back in a minute.",
  homeChangeDetail: "See exactly what changed",

  /* The words an owner would use, and none of git's. "Put this back" is what
     the welcome notice has always promised in prose; saying it identically on
     the button is the whole of making the promise findable. */
  homeRestore: "Put this back",
  homeRestoreConfirm:
    "This puts the pages this change touched back to how they were before it, and your site rebuilds. Sure?",
  homeRestoreYes: "Yes, put it back",
  homeRestoreBusy: "Putting it back…",
  homeRestoreDone:
    "Put back — {files}. Your site is rebuilding: give it a minute, then reload this page.",
  homeRestoreNothing: "That's already how your site is. Nothing changed.",
  homeRestoreFailed: "Couldn't put that back just now. Nothing was changed — try again in a moment.",
  page: "page",
  pages: "pages",

  homeChangeBy: "by {who}",
  /* A commit the editor did not write is one of ours. Saying "by sk" is both
     true and the thing that makes the row make sense to somebody who is sure
     they never touched it. */
  homeChangeByUs: "by sk",
  homeDeployLive: "Your last change is on the site.",
  homeDeployBuilding: "Your last change is going up now — give it a minute, then reload your site.",
  /* The host's own sentence, quoted. "Deployment rate limited — retry in 24
     hours" tells somebody what to do; "something went wrong" does not. */
  homeDeployFailed: "Your last change hasn't gone up yet: {reason}",

  homeRequestOpen: "Ask for a change",
  homeRequestTitle: "What would you like changed?",
  homeRequestPlaceholder: "A new section for workshops, with three photographs and a paragraph…",
  homeRequestNote: "This goes straight to the studio. Describe it however you like.",
  homeRequestSend: "Send",
  homeRequestSending: "Sending…",
  homeRequestSent: "Sent. You'll hear back.",
  homeRequestSeeIt: "Follow it here",
  homeRequestFailed: "Couldn't send that just now. Your words are still here — try again in a moment.",

  accountOpen: "Settings",
  accountTitle: "Settings",
  accountClose: "Close",
  accountWho: "Signed in as {who}",

  deviceTitle: "This device",
  deviceUnsupported: "This browser has no fingerprint or face unlock to offer.",
  deviceOffer: "Set this up and you can skip the Google step on this device.",
  deviceEnrol: "Set up quick unlock",
  deviceEnrolled: "Done. Next time, this device is enough.",
  deviceReady: "This device can open your editor without going through Google.",
  deviceForget: "Forget this device",
  deviceForgotten: "Forgotten. This device will ask for Google again.",

  deviceUnlock: "Unlock with this device",
  deviceNeedsSession: "Sign in once below, and this device can remember you next time.",

  deviceFailedNotConfigured: "This site isn't set up for that yet.",
  deviceFailedUnauthorized: "Your sign-in has expired. Sign in again first.",
  deviceFailedNotEnrolled: "This device isn't set up for that yet.",
  deviceFailedRefused: "This device wouldn't do it. Check that fingerprint or face unlock is switched on.",
  deviceFailedTooOld: "This browser is too old for that.",
  deviceFailedUnverified: "That didn't unlock. Try Google instead.",
  deviceFailedRevoked: "That account can no longer edit this site.",
  deviceFailedOffline: "No connection. Try again when you're back online.",
  deviceFailedUnknown: "That didn't work. Try Google instead.",

  installTitle: "Install",
  installNote: "Add the editor to your home screen and open it like an app.",
  installButton: "Add to home screen",
  installDone: "Installed — you're using it now.",
  installIos: "Tap the share button in Safari, then “Add to Home Screen”.",
  installLater: "Your browser will offer this once you've opened the editor a few times.",

  languageTitle: "Language",

  helpTitle: "Help",
  helpTour: "Show me around again",
  helpAsk: "Ask for a change",

  versionLabel: "Version {version}",

  cancel: "Cancel",
  visitor: "visitor",
  visitors: "visitors",
  view: "view",
  views: "views",
  today: "today",
  yesterday: "yesterday",
  daysAgo: "{days} days ago"
};

/** Elfine's French: `vous`, warm, no jargon, the guillemets and typographic
    apostrophes her own site uses. Two things this table does deliberately —
    it avoids past-participle agreement everywhere a count or a person could be
    either gender ("{count} à enregistrer", not "{count} non enregistrée"),
    because the kit does not know who is reading; and `sectionHidden` keeps all
    three of the English sentence's jobs rather than the short one. */
const fr: EditorStrings = {
  loading: "Chargement…",
  notConfigured:
    "L’éditeur n’est pas encore configuré pour ce site. Le site lui-même n’a aucun problème.",
  startFailed: "L’éditeur n’a pas pu démarrer.",

  signInTitle: "Connectez-vous pour modifier",
  signInWhat:
    "C’est ici que vous changez les mots et les images de votre propre site. Rien de ce que vous faites ici n’est définitif — chaque changement est conservé, et tout peut être remis comme avant.",
  signInNote:
    "Utilisez le compte Google avec lequel ce site a été créé. Rien d’autre ne peut entrer.",
  signInUnavailable:
    "La connexion n’est pas encore en place pour ce site — le client Google n’a pas été créé. " +
    "Rien n’est cassé ; il n’y a simplement rien à quoi se connecter.",
  signInFailed: "Cette connexion n’a pas fonctionné.",
  gisFailed: "Le script de connexion de Google ne s’est pas chargé.",
  signOut: "Se déconnecter",

  signInHandoff: "Se connecter avec Google",
  signInHandoffNote:
    "Vous vous connecterez sur notre page de connexion, puis vous reviendrez directement ici.",
  signInHandoffDown:
    "Notre page de connexion ne répond pas pour le moment. Votre site n’a aucun problème — " +
    "réessayez dans quelques minutes.",
  signInOther: "Un problème ? Connectez-vous directement avec Google",
  signInDenied: "Ce compte ne peut pas modifier ce site.",
  signInLapsedAway:
    "Se reconnecter veut dire quitter cette page. Copiez ce que vous avez écrit avant de partir.",

  /* «trouvé» would have to agree with whatever `{count}` turns out to be, and
     this table avoids that everywhere for the reason its header gives — so the
     count is placed rather than qualified. */
  searchLabel: "Chercher un mot partout sur votre site",
  searchCount: "{count} sur cette page",
  searchMatch: "résultat",
  searchMatches: "résultats",
  searchNothing: "Rien sur cette page ne contient ces mots.",
  searchNarrow: "Écrivez encore un peu pour affiner.",
  searchLooking: "Recherche sur vos autres pages…",
  searchElsewhere: "{count} sur vos autres pages",
  searchElsewhereNothing: "Rien non plus sur vos autres pages.",
  searchElsewhereFailed: "Impossible de chercher sur vos autres pages pour le moment.",

  editing: "Vous modifiez",
  editingFile: "Vous modifiez {path}",
  emptyList: "Rien ici pour l’instant.",
  optional: "facultatif",

  rowAdd: "Ajouter {label}",
  rowUp: "Monter",
  rowDown: "Descendre",
  rowRemove: "Retirer",
  rowRemoveConfirm: "Touchez encore pour retirer",

  imageChoose: "Choisir une photo",
  imageReplace: "Remplacer cette photo",
  imageWorking: "Préparation de la photo…",
  imageReady: "Prête — {width}×{height}, {size} kB. Elle ira sur le site quand vous enregistrerez.",
  imageTooBig: "Cette photo est trop lourde même après réduction. Essayez-en une plus petite.",
  imageWrongType:
    "Ce navigateur n’a pas produit de JPEG. Essayez une autre photo, ou l’éditeur complet sur un ordinateur.",
  imageUnreadable: "Ce fichier n’a pas pu être lu comme une photo.",
  imagePointAt: "Ou utilisez une image déjà sur le site",
  imageNeedsAlt:
    "Décrivez d’abord la nouvelle photo — c’est ce qu’entendront les personnes qui utilisent un lecteur d’écran.",

  save: "Enregistrer",
  saveCount: "Enregistrer {count}",
  change: "modification",
  changes: "modifications",
  saving: "Enregistrement…",
  saved: "Enregistré",
  savedNote: "Enregistré. Le site se reconstruit dans une minute environ — ",
  savedLink: "voir la modification",

  loadFailed: "Impossible de charger ce contenu.",
  saveFailed: "Impossible d’enregistrer cette modification.",
  saveUnreachable:
    "Impossible de joindre le site pour enregistrer. Tout ce que vous avez écrit est encore là — vérifiez votre connexion et appuyez de nouveau sur Enregistrer. Ne rechargez pas cette page pour l’instant.",
  saveRefused:
    "Le site a refusé cette modification. Rien de ce que vous avez écrit n’est perdu, mais appuyer de nouveau sur " +
    "Enregistrer n’y changera rien — envoyez cette page à la personne qui a mis votre site en place, elle pourra vous dire pourquoi.",
  invalid: "Cette modification n’entre pas dans le modèle de contenu.",
  conflict:
    "Quelqu’un d’autre a modifié cette page depuis que vous l’avez ouverte. Copiez d’abord votre texte si vous voulez " +
    "le garder — recharger reprend leur version et abandonne la vôtre.",
  reload: "Recharger",
  copyMine: "Copier mon texte",
  copiedMine: "Copié",
  fieldNeeded: "« {what} » ne peut pas rester vide — écrivez quelque chose et Enregistrer revient.",
  /* Impersonal on purpose: "vous avez été déconnecté" has to agree with a
     person this kit knows nothing about, so the session is the subject. */
  expired: "Votre session s’est terminée pendant que vous travailliez. Rien de ce que vous avez écrit n’est perdu —",
  expiredLink: "reconnectez-vous",
  openPage: "Modifier cette page sur le site",
  backToPage: "Retour à la page",

  sectionShow: "Afficher cette section sur le site",
  sectionHidden:
    "Cette section n’est pas sur le site en ce moment. Rien n’a été supprimé — tout ce que vous avez écrit est toujours là, " +
    "et c’est par cet interrupteur qu’elle revient. Elle ne sera pas sur la page elle-même tant qu’elle est masquée.",
  /* Feminine, because it is agreeing with `section` — the marker is read as
     "Contact — masquée", not as a label on a switch. */
  sectionOff: "Masquée",

  inlineIdle: "Touchez un texte surligné pour le changer.",
  inlineFocused: "Vous changez {what}",
  inlinePending: "{count} à enregistrer.",
  inlineNothing: "Rien sur cette page ne peut encore être modifié ici — essayez Accueil.",
  inlineSignIn: "Connectez-vous d’abord, puis revenez à cette page.",
  inlineSignInLink: "Se connecter",
  inlineDone: "Terminé",
  inlineRevert: "Annuler celui-ci",
  inlineDiscard: "Tout annuler",
  inlineHelp: "?",
  inlineHelpTitle: "Comment ça marche",
  inlineMore: "▾",
  inlineMoreTitle: "Plus",
  inlineHome: "Accueil",
  inlineHelpEdit:
    "Touchez un texte surligné et écrivez. Enregistrer apparaît dès que vous changez quelque chose, et rien n’est public tant que vous n’appuyez pas dessus.",
  inlineHelpCancel:
    "Appuyez sur Échap, ou sur « Annuler celui-ci », pour remettre un texte comme il était.",
  inlineHelpPanel: "Le texte en gris, vos visiteurs et tout le reste sont dans Accueil.",
  inlineHelpHidden:
    "Des sections entières se masquent et se réaffichent dans Accueil — une section masquée n’est pas du tout sur cette page.",
  inlinePanelOnly: "« {label} » contient de la mise en forme, il se modifie donc dans Accueil.",
  inlinePanelElsewhere: "« {label} » se modifie dans Accueil, pas ici sur la page.",
  inlinePanelLink: "Ouvrir Accueil",
  inlineBroken: "Ceci pointe vers « {path} », que le contenu n’a plus.",
  inlineBrokenSome:
    "Une partie du texte de cette page (marquée en rouge) pointe vers du contenu qui n’existe plus. C’est un défaut de la page, pas de ce que vous avez fait — tout le reste fonctionne.",
  inlineDraftFound: "Vous aviez {count} ici, sans enregistrer.",
  inlineDraftRestore: "Restaurer",
  inlineDraftDiscard: "Abandonner",
  inlineDraftStale:
    "Vous aviez des modifications non enregistrées ici, mais la page a été modifiée ailleurs depuis. Elles ont été abandonnées plutôt qu’écrites par-dessus.",
  inlineLeaveWarning: "Vous avez des modifications qui ne sont pas encore enregistrées.",

  /* Step 2 keeps the English sentence's two jobs in one line: écrivez par-dessus,
     and nothing is public until Enregistrer. The imperative is `vous`, like the
     rest of this table. */
  tourStep1: "Ce texte est le vôtre — touchez les mots surlignés pour les changer.",
  tourStep2:
    "Écrivez par-dessus. Enregistrer le rend réel — rien n’est public tant que vous n’appuyez pas sur Enregistrer.",
  tourStep3:
    "Accueil, c’est vos visiteurs, ce que vous avez changé, et l’endroit pour demander plus grand.",
  tourSkip: "Passer",
  tourDone: "C’est compris",
  inlineHelpTourAgain: "Remontrez-moi",

  hintEdit: "Modifier cette page",
  hintDismiss: "×",
  hintDismissTitle: "Ne plus proposer ceci sur cet appareil",

  siblingLabel: "Cette page existe aussi en :",
  siblingTitle: "Ouvrir cette page en {label}",

  homeWelcomeTitle: "C’est ici que vous changez votre site",
  homeWelcomeBody:
    "Tout ce que vous écrivez ici va sur votre vrai site, en général en une ou deux minutes. Vous pouvez aussi toucher les mots sur vos propres pages et écrire par-dessus.",
  homeWelcomeUndo:
    "Rien de ce que vous faites ici n’est définitif. Chaque changement ci-dessous a un « Remettre comme avant » à côté, et tout ce qui est plus ancien peut aussi être remis — il suffit de demander.",
  homeWelcomeAsk:
    "Pour tout ce qui dépasse les mots et les images — une nouvelle section, une autre mise en page — utilisez « Demander un changement » ci-dessous et décrivez ce que vous voulez.",
  homeWelcomeClose: "C’est compris",
  homeWelcomeShowMe: "Montrez-moi",
  homeHelp: "?",
  homeHelpTitle: "Qu’est-ce que c’est ?",

  homeTrafficTitle: "Est-ce que quelqu’un est venu ?",
  homeTrafficLine: "{visitors} et {views} ces {days} derniers jours",
  homeTrafficChange: "{percent}% par rapport aux {days} jours précédents",
  homeTrafficNone: "Personne pour l’instant. C’est normal pour un site qui vient d’être mis en ligne.",
  homePagesTitle: "Les plus lues",
  homePageLine: "{path} — {views}",
  homeShareLink: "Voir tous vos chiffres de visite",

  homeChangesTitle: "Ce qui a changé",
  homeChangesNone:
    "Rien n’a encore changé. Choisissez une page ci-dessous et essayez quelque chose — vous pouvez toujours le remettre.",
  homeChangesUnavailable:
    "Impossible de lire vos changements récents pour le moment. Votre site va bien et vos mots aussi — cette liste devrait revenir dans une minute.",
  homeChangeDetail: "Voir exactement ce qui a changé",

  homeRestore: "Remettre comme avant",
  homeRestoreConfirm:
    "Cela remet les pages touchées par ce changement comme elles étaient avant, et votre site est reconstruit. C’est bien ça ?",
  homeRestoreYes: "Oui, remettez-le",
  homeRestoreBusy: "On le remet…",
  homeRestoreDone:
    "Remis comme avant — {files}. Votre site se reconstruit : laissez-lui une minute, puis rechargez cette page.",
  homeRestoreNothing: "Votre site est déjà comme ça. Rien n’a changé.",
  homeRestoreFailed:
    "Impossible de le remettre pour le moment. Rien n’a changé — réessayez dans un instant.",
  page: "page",
  pages: "pages",

  homeChangeBy: "par {who}",
  homeChangeByUs: "par sk",
  homeDeployLive: "Votre dernier changement est sur le site.",
  homeDeployBuilding:
    "Votre dernier changement est en train de monter — laissez-lui une minute, puis rechargez votre site.",
  homeDeployFailed: "Votre dernier changement n’est pas encore en ligne : {reason}",

  homeRequestOpen: "Demander un changement",
  homeRequestTitle: "Qu’aimeriez-vous changer ?",
  homeRequestPlaceholder: "Une nouvelle section pour les ateliers, avec trois photos et un paragraphe…",
  homeRequestNote: "Cela va directement au studio. Décrivez-le comme vous voulez.",
  homeRequestSend: "Envoyer",
  homeRequestSending: "Envoi…",
  homeRequestSent: "Envoyé. Vous aurez une réponse.",
  homeRequestSeeIt: "Suivez-le ici",
  homeRequestFailed:
    "Impossible d’envoyer pour le moment. Vos mots sont toujours là — réessayez dans un instant.",

  accountOpen: "Réglages",
  accountTitle: "Réglages",
  accountClose: "Fermer",
  /* "Compte :" plutôt que "Connecté(e) en tant que" — le kit sert plusieurs
     sites et ne sait rien de la personne qui lit, et une parenthèse de genre
     dans une interface est un aveu d'ignorance. */
  accountWho: "Compte : {who}",

  deviceTitle: "Cet appareil",
  deviceUnsupported: "Ce navigateur n'a ni empreinte ni reconnaissance faciale à proposer.",
  deviceOffer: "Configurez-le et vous pourrez sauter l'étape Google sur cet appareil.",
  deviceEnrol: "Configurer le déverrouillage rapide",
  deviceEnrolled: "C'est fait. La prochaine fois, cet appareil suffira.",
  deviceReady: "Cet appareil peut ouvrir votre éditeur sans passer par Google.",
  deviceForget: "Oublier cet appareil",
  deviceForgotten: "Oublié. Cet appareil redemandera Google.",

  deviceUnlock: "Déverrouiller avec cet appareil",
  deviceNeedsSession: "Connectez-vous une fois ci-dessous, et cet appareil pourra se souvenir de vous.",

  deviceFailedNotConfigured: "Ce site n'est pas encore configuré pour cela.",
  deviceFailedUnauthorized: "Votre session a expiré. Reconnectez-vous d'abord.",
  deviceFailedNotEnrolled: "Cet appareil n'est pas encore configuré pour cela.",
  deviceFailedRefused: "Cet appareil a refusé. Vérifiez que l'empreinte ou la reconnaissance faciale est activée.",
  deviceFailedTooOld: "Ce navigateur est trop ancien pour cela.",
  deviceFailedUnverified: "Le déverrouillage a échoué. Essayez plutôt Google.",
  deviceFailedRevoked: "Ce compte ne peut plus modifier ce site.",
  deviceFailedOffline: "Pas de connexion. Réessayez une fois de retour en ligne.",
  deviceFailedUnknown: "Cela n'a pas fonctionné. Essayez plutôt Google.",

  installTitle: "Installer",
  installNote: "Ajoutez l'éditeur à votre écran d'accueil et ouvrez-le comme une application.",
  installButton: "Ajouter à l'écran d'accueil",
  installDone: "Installé — vous l'utilisez en ce moment.",
  installIos: "Touchez le bouton Partager dans Safari, puis « Sur l'écran d'accueil ».",
  installLater: "Votre navigateur vous le proposera après quelques visites.",

  languageTitle: "Langue",

  helpTitle: "Aide",
  helpTour: "Revoir la visite guidée",
  helpAsk: "Demander un changement",

  versionLabel: "Version {version}",

  cancel: "Annuler",
  visitor: "visiteur",
  visitors: "visiteurs",
  view: "vue",
  views: "vues",
  today: "aujourd’hui",
  yesterday: "hier",
  daysAgo: "il y a {days} jours"
};

/** Nima's Farsi: informal and direct, the same register his review widget
    already speaks to his visitors in — and he is the owner, so the editor has
    no reason to be more formal with him than his own site is.

    `change` and `changes` are the same word, and that is correct rather than
    lazy: Persian does not pluralise a noun after a numeral, so "۲ تغییر" is
    what a Persian reader expects and "۲ تغییرها" is wrong. `plural()` puts the
    number in front of whichever it picks, so both keys must be the singular.

    The numbers are not shaped here and never will be: a table cannot hold a
    count it has never seen. Step 1 of 0.17.0 shipped this table with Latin
    digits inside Persian sentences for exactly that reason, and step 2 paid it
    with `digitsFor` — `plural()` and the bar's count chip both take a
    formatter now, so "۲ تغییر" is what an owner reads. */
const fa: EditorStrings = {
  loading: "در حال بارگذاری…",
  notConfigured: "ویرایشگر هنوز برای این سایت تنظیم نشده. خود سایت هیچ مشکلی ندارد.",
  startFailed: "ویرایشگر بالا نیامد.",

  signInTitle: "برای ویرایش وارد شو",
  signInWhat:
    "اینجا جایی است که کلمه‌ها و عکس‌های سایت خودت را عوض می‌کنی. هیچ‌کدام از کارهایت اینجا همیشگی نیست — هر تغییری نگه داشته می‌شود و هر چیزی را می‌شود به حالت اولش برگرداند.",
  signInNote: "با همان حساب گوگلی وارد شو که سایت با آن ساخته شده. هیچ‌کس دیگری راه ندارد.",
  signInUnavailable:
    "ورود برای این سایت هنوز راه نیفتاده — کلاینت گوگلش ساخته نشده. " +
    "چیزی خراب نیست؛ فقط فعلاً جایی برای وارد شدن وجود ندارد.",
  signInFailed: "این ورود نگرفت.",
  gisFailed: "اسکریپت ورود گوگل بارگذاری نشد.",
  signOut: "خروج از حساب",

  signInHandoff: "ورود با گوگل",
  signInHandoffNote: "در صفحهٔ ورود ما وارد می‌شوی و بعدش یک‌راست به همین‌جا برمی‌گردی.",
  signInHandoffDown:
    "صفحهٔ ورود ما الان جواب نمی‌دهد. سایت تو هیچ مشکلی ندارد — چند دقیقهٔ دیگر دوباره امتحان کن.",
  signInOther: "مشکلی هست؟ مستقیم با گوگل وارد شو",
  signInDenied: "این حساب اجازهٔ ویرایش این سایت را ندارد.",
  signInLapsedAway:
    "برای ورود دوباره باید از این صفحه بروی. هرچه نوشته‌ای را اول جایی کپی کن.",

  /* `searchMatch` and `searchMatches` are the same word for the same reason
     `change` and `changes` are: Persian does not pluralise a noun after a
     numeral, so «۳ مورد» is what a Persian reader expects. */
  searchLabel: "دنبال کلمه‌ای در هر جای سایتت بگرد",
  searchCount: "{count} در این صفحه",
  searchMatch: "مورد",
  searchMatches: "مورد",
  searchNothing: "هیچ‌چیزی در این صفحه این کلمه‌ها را ندارد.",
  searchNarrow: "کمی بیشتر بنویس تا نتیجه‌ها کمتر شوند.",
  searchLooking: "در صفحه‌های دیگرت هم می‌گردم…",
  searchElsewhere: "{count} در صفحه‌های دیگرت",
  searchElsewhereNothing: "در صفحه‌های دیگرت هم چیزی نبود.",
  searchElsewhereFailed: "الان نتوانستم در صفحه‌های دیگرت بگردم.",

  editing: "در حال ویرایش",
  editingFile: "در حال ویرایش {path}",
  emptyList: "هنوز چیزی اینجا نیست.",
  optional: "اختیاری",

  rowAdd: "افزودن {label}",
  rowUp: "ببر بالا",
  rowDown: "ببر پایین",
  rowRemove: "حذف",
  rowRemoveConfirm: "برای حذف دوباره بزن",

  imageChoose: "یک عکس انتخاب کن",
  imageReplace: "این عکس را عوض کن",
  imageWorking: "عکس دارد آماده می‌شود…",
  imageReady: "آماده است — {width}×{height}، {size} کیلوبایت. با ذخیره روی سایت می‌رود.",
  imageTooBig: "این عکس حتی بعد از کوچک شدن هم زیادی سنگین است. یکی کوچک‌تر امتحان کن.",
  imageWrongType:
    "این مرورگر JPEG نساخت. عکس دیگری امتحان کن، یا ویرایشگر کامل را روی کامپیوتر باز کن.",
  imageUnreadable: "این فایل به‌عنوان عکس خوانده نشد.",
  imagePointAt: "یا از عکسی که همین حالا روی سایت است استفاده کن",
  imageNeedsAlt:
    "اول عکس تازه را توصیف کن — این همان چیزی است که کسانی که از صفحه‌خوان استفاده می‌کنند می‌شنوند.",

  save: "ذخیره",
  saveCount: "ذخیره {count}",
  change: "تغییر",
  changes: "تغییر",
  saving: "در حال ذخیره…",
  saved: "ذخیره شد",
  savedNote: "ذخیره شد. سایت تا حدود یک دقیقه دیگر دوباره ساخته می‌شود — ",
  savedLink: "تغییر را ببین",

  loadFailed: "این محتوا خوانده نشد.",
  saveFailed: "این تغییر ذخیره نشد.",
  saveUnreachable:
    "برای ذخیره به سایت نرسیدیم. هرچه نوشته‌ای همین‌جا هست — اتصالت را نگاه کن و دوباره ذخیره را بزن. فعلاً این صفحه را دوباره بارگذاری نکن.",
  saveRefused:
    "سایت این تغییر را نپذیرفت. هرچه نوشته‌ای از بین نرفته، اما دوباره زدن ذخیره فایده‌ای ندارد — " +
    "این صفحه را برای کسی که سایتت را راه انداخته بفرست تا بگوید چرا.",
  invalid: "این تغییر با ساختار محتوا جور درنمی‌آید.",
  conflict:
    "از وقتی این صفحه را باز کرده‌ای کس دیگری عوضش کرده. اگر می‌خواهی نوشته‌هایت بماند، اول کپی‌شان کن — " +
    "بارگذاری دوباره نسخهٔ او را می‌آورد و نوشتهٔ تو را کنار می‌گذارد.",
  reload: "بارگذاری دوباره",
  copyMine: "متن من را کپی کن",
  copiedMine: "کپی شد",
  fieldNeeded: "«{what}» نمی‌تواند خالی بماند — چیزی در آن بنویس تا ذخیره برگردد.",
  expired: "وسط کار از حساب بیرون آمدی. هیچ‌کدام از نوشته‌هایت از بین نرفته —",
  expiredLink: "دوباره وارد شو",
  openPage: "این صفحه را روی خود سایت ویرایش کن",
  backToPage: "برگرد به صفحه",

  sectionShow: "این بخش روی سایت نشان داده شود",
  sectionHidden:
    "این بخش الان روی سایت نیست. چیزی حذف نشده — هرچه نوشته‌ای سر جایش است، " +
    "و همین کلید جایی است که برمی‌گردد. تا وقتی خاموش است، روی خود صفحه هم نخواهد بود.",
  /* The same word `sectionHidden` already uses for this state two lines up, so
     the marker and the sentence explaining it are not two vocabularies. */
  sectionOff: "خاموش",

  inlineIdle: "روی هر متن هایلایت‌شده بزن تا عوضش کنی.",
  inlineFocused: "در حال تغییر {what}",
  inlinePending: "{count} هنوز ذخیره نشده.",
  inlineNothing: "فعلاً چیزی در این صفحه از همین‌جا عوض نمی‌شود — خانه را امتحان کن.",
  inlineSignIn: "اول وارد شو، بعد به این صفحه برگرد.",
  inlineSignInLink: "ورود",
  inlineDone: "تمام",
  inlineRevert: "همین یکی را برگردان",
  inlineDiscard: "همه را برگردان",
  inlineHelp: "?",
  inlineHelpTitle: "این چطور کار می‌کند",
  inlineMore: "▾",
  inlineMoreTitle: "بیشتر",
  inlineHome: "خانه",
  inlineHelpEdit:
    "روی متن هایلایت‌شده بزن و بنویس. تا چیزی را عوض کنی دکمه‌ی ذخیره ظاهر می‌شود، و تا نزنی‌اش هیچ‌چیز عمومی نمی‌شود.",
  inlineHelpCancel:
    "برای اینکه یک متن به حالت اولش برگردد، Escape را بزن یا «همین یکی را برگردان».",
  inlineHelpPanel: "متن خاکستری، بازدیدکننده‌هایت و بقیه‌ی چیزها در خانه هستند.",
  inlineHelpHidden:
    "بخش‌های کامل را هم در خانه می‌شود خاموش و روشن کرد — بخشی که خاموش است اصلاً روی این صفحه نیست.",
  inlinePanelOnly: "«{label}» قالب‌بندی دارد، برای همین در خانه عوض می‌شود.",
  inlinePanelElsewhere: "«{label}» در خانه عوض می‌شود، نه همین‌جا روی صفحه.",
  inlinePanelLink: "خانه را باز کن",
  inlineBroken: "این به «{path}» اشاره می‌کند که دیگر در محتوا نیست.",
  inlineBrokenSome:
    "بخشی از متن این صفحه (با قرمز مشخص شده) به محتوایی اشاره می‌کند که دیگر وجود ندارد. این ایراد خود صفحه است، نه کاری که تو کرده‌ای — بقیه‌اش همچنان کار می‌کند.",
  inlineDraftFound: "{count} را اینجا ذخیره‌نشده گذاشته بودی.",
  inlineDraftRestore: "برگردان",
  inlineDraftDiscard: "بی‌خیال",
  inlineDraftStale:
    "اینجا تغییرهای ذخیره‌نشده داشتی، ولی از آن موقع صفحه جای دیگری عوض شده. به‌جای اینکه روی آن نوشته شوند، کنار گذاشته شدند.",
  inlineLeaveWarning: "تغییرهایی داری که هنوز ذخیره نشده.",

  /* Nimagiti's own register: informal, direct, second person singular — the same
     voice `inlineHelpEdit` uses two lines up. «ذخیره» is the button's own word,
     so step 2 names it the way the bar does. */
  tourStep1: "این متن مال خودت است — روی کلمه‌های هایلایت‌شده بزن تا عوضشان کنی.",
  tourStep2: "رویش بنویس. ذخیره واقعی‌اش می‌کند — تا ذخیره را نزنی هیچ‌چیز عمومی نمی‌شود.",
  tourStep3: "خانه بازدیدکننده‌هایت، آنچه عوض کرده‌ای، و جای درخواست چیزهای بزرگ‌تر است.",
  tourSkip: "رد کن",
  tourDone: "فهمیدم",
  inlineHelpTourAgain: "دوباره نشانم بده",

  hintEdit: "این صفحه را ویرایش کن",
  hintDismiss: "×",
  hintDismissTitle: "دیگر این را روی این دستگاه پیشنهاد نده",

  siblingLabel: "این صفحه به این زبان هم هست:",
  siblingTitle: "این صفحه را به {label} باز کن",

  homeWelcomeTitle: "اینجا جایی است که سایتت را عوض می‌کنی",
  homeWelcomeBody:
    "هرچه اینجا بنویسی روی سایت واقعی‌ات می‌رود، معمولاً تا یکی دو دقیقه. می‌توانی روی کلمه‌های صفحه‌های خودت هم بزنی و رویشان بنویسی.",
  homeWelcomeUndo:
    "هیچ‌کدام از کارهایت اینجا همیشگی نیست. کنار هر تغییر پایین یک «برش گردان» هست، و هر چیز قدیمی‌تر را هم می‌شود برگرداند — فقط بگو.",
  homeWelcomeAsk:
    "برای هرچیزی بزرگ‌تر از کلمه و عکس — یک بخش تازه، یک چیدمان دیگر — از «درخواست تغییر» پایین استفاده کن و بنویس چه می‌خواهی.",
  homeWelcomeClose: "فهمیدم",
  homeWelcomeShowMe: "نشانم بده",
  homeHelp: "?",
  homeHelpTitle: "این چیست؟",

  homeTrafficTitle: "کسی آمد؟",
  homeTrafficLine: "{visitors} و {views} در {days} روز گذشته",
  homeTrafficChange: "{percent}% نسبت به {days} روز قبلش",
  homeTrafficNone: "هنوز هیچ‌کس. برای سایتی که تازه بالا آمده طبیعی است.",
  homePagesTitle: "بیشترین خوانده‌شده",
  homePageLine: "{path} — {views}",
  homeShareLink: "همه‌ی آمار بازدیدت را ببین",

  homeChangesTitle: "چه چیزی عوض شد",
  homeChangesNone:
    "هنوز چیزی عوض نشده. یکی از صفحه‌های پایین را بردار و چیزی را امتحان کن — همیشه می‌شود برش گرداند.",
  homeChangesUnavailable:
    "الان نشد تغییرهای اخیرت را خواند. سایتت سالم است و نوشته‌هایت هم — این فهرست تا یک دقیقه دیگر برمی‌گردد.",
  homeChangeDetail: "دقیقاً ببین چه عوض شد",

  homeRestore: "برش گردان",
  homeRestoreConfirm:
    "این صفحه‌هایی را که این تغییر دست زده به حالت قبلش برمی‌گرداند و سایتت دوباره ساخته می‌شود. مطمئنی؟",
  homeRestoreYes: "آره، برش گردان",
  homeRestoreBusy: "دارد برمی‌گردد…",
  homeRestoreDone:
    "برگشت — {files}. سایتت دارد دوباره ساخته می‌شود: یک دقیقه صبر کن، بعد این صفحه را تازه کن.",
  homeRestoreNothing: "سایتت همین‌الان همین‌طور است. چیزی عوض نشد.",
  homeRestoreFailed: "الان نشد برش گرداند. چیزی عوض نشد — کمی بعد دوباره امتحان کن.",
  page: "صفحه",
  pages: "صفحه",

  homeChangeBy: "به‌دست {who}",
  homeChangeByUs: "به‌دست sk",
  homeDeployLive: "آخرین تغییرت روی سایت است.",
  homeDeployBuilding: "آخرین تغییرت دارد بالا می‌رود — یک دقیقه صبر کن، بعد سایتت را دوباره بارگذاری کن.",
  homeDeployFailed: "آخرین تغییرت هنوز بالا نرفته: {reason}",

  homeRequestOpen: "درخواست تغییر",
  homeRequestTitle: "دوست داری چه چیزی عوض شود؟",
  homeRequestPlaceholder: "یک بخش تازه برای کارگاه‌ها، با سه عکس و یک پاراگراف…",
  homeRequestNote: "این مستقیم می‌رود به استودیو. هرطور دوست داری توضیحش بده.",
  homeRequestSend: "بفرست",
  homeRequestSending: "در حال ارسال…",
  homeRequestSent: "فرستاده شد. جوابش را می‌گیری.",
  homeRequestSeeIt: "از همین‌جا دنبالش کن",
  homeRequestFailed: "الان فرستاده نشد. نوشته‌هایت همین‌جاست — کمی بعد دوباره امتحان کن.",

  accountOpen: "تنظیمات",
  accountTitle: "تنظیمات",
  accountClose: "بستن",
  accountWho: "حساب: {who}",

  deviceTitle: "این دستگاه",
  deviceUnsupported: "این مرورگر اثر انگشت یا تشخیص چهره ندارد.",
  deviceOffer: "این را تنظیم کن تا دفعهٔ بعد لازم نباشد از گوگل رد شوی.",
  deviceEnrol: "تنظیم باز کردن سریع",
  deviceEnrolled: "انجام شد. دفعهٔ بعد همین دستگاه کافی است.",
  deviceReady: "این دستگاه می‌تواند ویرایشگر را بدون گوگل باز کند.",
  deviceForget: "این دستگاه را فراموش کن",
  deviceForgotten: "فراموش شد. این دستگاه دوباره سراغ گوگل می‌رود.",

  deviceUnlock: "باز کردن با این دستگاه",
  deviceNeedsSession: "یک بار از پایین وارد شو تا این دستگاه دفعهٔ بعد تو را به یاد بیاورد.",

  deviceFailedNotConfigured: "این سایت هنوز برای این کار آماده نیست.",
  deviceFailedUnauthorized: "ورودت منقضی شده. اول دوباره وارد شو.",
  deviceFailedNotEnrolled: "این دستگاه هنوز برای این کار تنظیم نشده.",
  deviceFailedRefused: "دستگاه قبول نکرد. ببین اثر انگشت یا تشخیص چهره روشن است.",
  deviceFailedTooOld: "این مرورگر برای این کار خیلی قدیمی است.",
  deviceFailedUnverified: "باز نشد. با گوگل امتحان کن.",
  deviceFailedRevoked: "این حساب دیگر اجازهٔ ویرایش این سایت را ندارد.",
  deviceFailedOffline: "اینترنت وصل نیست. وقتی برگشتی دوباره امتحان کن.",
  deviceFailedUnknown: "نشد. با گوگل امتحان کن.",

  installTitle: "نصب",
  installNote: "ویرایشگر را به صفحهٔ اصلی اضافه کن و مثل یک برنامه بازش کن.",
  installButton: "افزودن به صفحهٔ اصلی",
  installDone: "نصب شده — همین حالا داری از آن استفاده می‌کنی.",
  installIos: "دکمهٔ اشتراک‌گذاری را در سفاری بزن و بعد «افزودن به صفحهٔ اصلی» را انتخاب کن.",
  installLater: "مرورگرت بعد از چند بار باز کردن، خودش پیشنهاد می‌دهد.",

  languageTitle: "زبان",

  helpTitle: "راهنما",
  helpTour: "دوباره راهنما را نشانم بده",
  helpAsk: "درخواست تغییر",

  versionLabel: "نسخهٔ {version}",

  cancel: "بی‌خیال",
  visitor: "بازدیدکننده",
  visitors: "بازدیدکننده",
  view: "بازدید",
  views: "بازدید",
  today: "امروز",
  yesterday: "دیروز",
  daysAgo: "{days} روز پیش"
};

/** Every locale the editor ships, by the language subtag it answers to. The
    same three the widget ships, and for the same reason: these are the
    languages the fleet's owners actually read. */
export const editorLocales: Record<string, EditorStrings> = { en: defaultStrings, fr, fa };

/** What the language switcher offers, each language named in its own script.

    Deliberately not translated and deliberately not derived from `Intl`: a
    reader hunting for their own language is scanning for the word *they* call
    it, and "Persian" in an English list helps nobody who reads only Persian.
    Three entries because the kit ships three tables — a site that overrides
    the tables into a fourth language is pinning `lang` anyway, and a switcher
    offering a language the kit has no words for would be the same broken
    promise this release is about. */
export const PANEL_LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "fa", label: "فارسی" }
];

/** The primary subtag, lowercased: `fa-IR` and `FA` both give `fa`. */
function primary(lang: string | null | undefined): string {
  return (lang ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
}

/** The table for a BCP-47 tag, falling back to English rather than to blanks.
    Split on the tag rather than prefix-matched, so `fao` is Faroese and not
    Farsi — the bug both site forks of the widget carried. */
export function stringsFor(lang: string | null | undefined): EditorStrings {
  return editorLocales[primary(lang)] ?? defaultStrings;
}

/** The locale table for a language, with a site's overrides on top. The order
    is the point: a site translating one word into a language the kit already
    ships keeps the other hundred and twelve. */
export function editorStrings(
  lang: string | null | undefined,
  overrides?: Partial<EditorStrings>
): EditorStrings {
  return { ...stringsFor(lang), ...overrides };
}

/* The right-to-left scripts, which is deliberately a wider list than the three
   locales above. A site may override the tables into Arabic or Hebrew without
   the kit shipping either, and a right-to-left language in a left-to-right box
   is exactly the failure the audit found on nimagiti's Farsi page. Direction
   is a property of the language, not of whether we happen to have a table. */
const RTL = new Set(["ar", "fa", "he", "ur", "ps", "sd", "ug", "yi", "dv", "ku"]);

/** `dir` for a language tag. */
export function dirFor(lang: string | null | undefined): "ltr" | "rtl" {
  return RTL.has(primary(lang)) ? "rtl" : "ltr";
}

/** Numbers as the language writes them.
    -------------------------------------------------------------------------
    0.17.0's step 1 shipped Farsi words with Latin digits — "۲ تغییر" arrived as
    "2 تغییر", because the count came from `plural()` and a table cannot hold a
    number it has never seen. This is the fix, and it is `Intl` rather than a
    digit map for the same reason `dirFor` is a set of languages rather than a
    per-table flag: the digit set belongs to the language, not to whether the
    kit happens to have words for it. A site that overrides the tables into
    Arabic gets ٢ without asking.

    This is the one place in this file that does **not** cut the tag down to its
    primary subtag, and that was measured rather than reasoned. A numbering
    system is a property of the *locale*, not of the language: CLDR gives bare
    `ar` Latin digits and `ar-EG` Arabic-Indic ones, `ur` Latin and `ur-IN`
    Persian. Truncating would hand `ar-EG` the answer for `ar` — the mirror of
    the bug `stringsFor` avoids by truncating, where `fao` must not find the
    Farsi table. Two questions, two ways of reading the same tag.

    Formatters are cached because the bar asks on every keystroke, and the
    fallback is `String` rather than a throw: a malformed tag from a site's
    `lang` attribute must cost Latin digits, never the whole editor. */
const digitCache = new Map<string, (n: number) => string>();

export function digitsFor(lang: string | null | undefined): (n: number) => string {
  /* An underscore is not a BCP-47 separator and `Intl` throws on it, while
     `<html lang="fa_IR">` is a real thing to find on a real site. */
  const tag = (lang ?? "").trim().toLowerCase().replace(/_/g, "-") || "en";
  const cached = digitCache.get(tag);
  if (cached) return cached;
  let format: (n: number) => string;
  try {
    const formatter = new Intl.NumberFormat(tag);
    format = (n) => formatter.format(n);
  } catch {
    format = String;
  }
  digitCache.set(tag, format);
  return format;
}

/** `?lang=` on the panel's URL. */
export const LANG_PARAM = "lang";
/** Where the panel remembers the answer, so it is asked once. */
export const LANG_STORE = "sk-editor-lang";

/** Where the panel's language can come from, in the order it asks.
    ---------------------------------------------------------------------------
    The bar does not need this: it reads `<html lang>` off the page the owner is
    editing, which is right by construction on every site in the fleet. The
    panel has no such page — one `/edit` route serves both halves of a bilingual
    site and its document is a hard-coded `lang="en"` — so it has to ask. */
export interface LangSources {
  /** `?lang=`, which the bar's links to the panel carry, so an owner who came
      from `/fa/` arrives in Farsi. */
  asked?: string | null;
  /** What the panel remembered last time. */
  remembered?: string | null;
  /** `navigator.languages`, in the browser's own order of preference. */
  preferred?: readonly string[] | null;
}

/** The first of the sources that names a language the kit ships, or `"en"`.
    Returns a subtag rather than a table, because the caller has to write it to
    `<html lang>` and remember it as well as look up words with it.

    A tag the kit does not ship is *skipped*, not accepted: a browser whose
    first preference is German and whose second is French should get French,
    not English-because-German-failed. */
export function resolveEditorLang(sources: LangSources): string {
  const candidates = [
    sources.asked,
    sources.remembered,
    ...(sources.preferred ?? [])
  ];
  for (const candidate of candidates) {
    const tag = primary(candidate);
    if (tag && editorLocales[tag]) return tag;
  }
  return "en";
}

/** `fill("Editing {path}", { path: "home.yaml" })`. Absent keys are left as
    they are, so a half-translated string still reads as a template rather
    than as an empty gap. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = values[key];
    return value === undefined ? whole : String(value);
  });
}
