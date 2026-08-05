/* Every word the review widget says.
   ---------------------------------------------------------------------------
   Collected in one object so a site can translate the widget without owning a
   copy of it — `mountReviewWidget({ strings: { send: "Enviar" } })`. The same
   shape as the editor's `EditorStrings`, deliberately: two surfaces in this
   kit ask a site for words and they should ask the same way.

   The three tables below are not new writing. Until 0.16.0 every site carried
   its own `feedback-chrome.js`, and two of the six had *forked* it to
   translate this table: elfine-site into French, nimagiti into Farsi. Both
   were lifted here character for character, which is checked rather than
   asserted — `scripts/extract-widget-strings.mjs` pulled them out of those two
   repos mechanically, the result is committed as
   `test/fixtures/widget-strings.forked.json`, and `widget-strings.test.ts`
   compares these tables against it. That fixture is the only surviving record
   of what six live sites were serving, because the files it was read from are
   deleted by the same release.

   `{n}` placeholders are filled by `fill()`.

   `sentBody` used to be a deliberate exception to the editor's rule that
   "nothing here names a studio, an owner or a site" — it said *Shahin* in all
   three tables, on the argument that all six sites were already saying it. The
   argument was backwards. What it was defending is the reason to change it: a
   reviewer on a client's site was reading a stranger's first name as the
   confirmation that their note had gone somewhere, and no site that is not
   ours should have to override a string to stop naming somebody. It now says
   only that the note arrived, which is the sentence's whole job and is true
   everywhere. The exception is gone and there is no longer any difference from
   the editor's rule; `widget-strings.test.ts` holds the tables to it. */

export interface WidgetStrings {
  /** The pill's resting label, and what it goes back to after picking. */
  comment: string;
  /** The pill's label while the visitor is choosing what to comment on. */
  picking: string;
  cancel: string;
  wholePage: string;
  exit: string;
  placeholder: string;
  namePlaceholder: string;
  photo: string;
  photoHint: string;
  remove: string;
  send: string;
  sending: string;
  /** The toast after the confirmation card closes. */
  sent: string;
  sentTitle: string;
  sentBody: string;
  /** Prefixed to whatever the network said, so a failure is never mute. */
  failed: string;
  copy: string;
  copied: string;
  /** The ⤴ button: widen the selection to the parent element. */
  broaden: string;
  /** What a note with no element attached is called. Also handed to the kit's
      context extractor, so the payload and the card agree. */
  wholePageLabel: string;
  tooBig: string;
  badImage: string;
  empty: string;
  /** The one-off toast that says review mode is on and what to do with it. */
  intro: string;
  countOne: string;
  /** `{n}` — "3 notes sent". */
  countMany: string;

  /* The two below had no entry in any of the six copies: they were hardcoded
     English in every one, including both forks, so a Farsi reviewer on
     nimagiti met "Review mode" and "More" in a screen reader. Being strings
     nobody could translate is how they stayed wrong. */

  /** The widget root's `aria-label`. */
  regionLabel: string;
  /** The ▾ button's `aria-label`. */
  more: string;
}

/** English, exactly as the four monolingual sites were serving it. */
export const defaultStrings: WidgetStrings = {
  comment: "Comment",
  picking: "Tap whatever you mean",
  cancel: "Cancel",
  wholePage: "Comment on the whole page",
  exit: "Leave review mode",
  placeholder: "What’s on your mind?",
  namePlaceholder: "Your first name",
  photo: "Add a photo",
  photoHint: "or paste a screenshot",
  remove: "Remove",
  send: "Send",
  sending: "Sending…",
  sent: "Sent — thank you!",
  sentTitle: "Sent!",
  sentBody: "Your note landed. Keep going — leave as many as you like.",
  failed: "Couldn’t send that.",
  copy: "Copy the text",
  copied: "Copied",
  broaden: "Select more",
  wholePageLabel: "Whole page",
  tooBig: "That image is too heavy — try a smaller one.",
  badImage: "Couldn’t read that image.",
  empty: "Write something first.",
  intro: "Review mode — tap anything to leave a note.",
  countOne: "1 note sent",
  countMany: "{n} notes sent",
  regionLabel: "Review mode",
  more: "More"
};

/** Elfine's French, lifted from `elfine-site/src/scripts/feedback-chrome.js`. */
const fr: WidgetStrings = {
  comment: "Commenter",
  picking: "Touchez l’élément concerné",
  cancel: "Annuler",
  wholePage: "Commenter la page entière",
  exit: "Quitter le mode révision",
  placeholder: "Qu’est-ce qui vous vient à l’esprit ?",
  namePlaceholder: "Votre prénom",
  photo: "Ajouter une photo",
  photoHint: "ou collez une capture d’écran",
  remove: "Retirer",
  send: "Envoyer",
  sending: "Envoi…",
  sent: "Envoyé, merci !",
  sentTitle: "C’est envoyé !",
  sentBody: "Votre note est bien arrivée. Continuez, il y en a autant que vous voulez.",
  failed: "Envoi impossible.",
  copy: "Copier le texte",
  copied: "Copié",
  broaden: "Élargir la sélection",
  wholePageLabel: "Page entière",
  tooBig: "Image trop lourde, essayez-en une plus petite.",
  badImage: "Impossible de lire cette image.",
  empty: "Écrivez d’abord un mot.",
  intro: "Mode révision — touchez n’importe quoi pour laisser une note.",
  countOne: "1 note envoyée",
  countMany: "{n} notes envoyées",
  regionLabel: "Mode révision",
  more: "Plus"
};

/** Nima's Farsi, lifted from `nimagiti/src/scripts/feedback-chrome.js`. The
    register is his site's own: informal and direct. `countOne` counts with a
    Persian numeral, which is why it is a string and not a number. */
const fa: WidgetStrings = {
  comment: "نظر بده",
  picking: "روی همان‌جا بزن",
  cancel: "بی‌خیال",
  wholePage: "نظر درباره‌ی کل صفحه",
  exit: "خروج از حالت بازبینی",
  placeholder: "چی توی ذهنته؟",
  namePlaceholder: "اسم کوچکت",
  photo: "افزودن عکس",
  photoHint: "یا اسکرین‌شات را همین‌جا پیست کن",
  remove: "حذف",
  send: "بفرست",
  sending: "در حال ارسال…",
  sent: "رسید — ممنون!",
  sentTitle: "رسید!",
  sentBody: "یادداشتت رسید. ادامه بده — هرچندتا خواستی بنویس.",
  failed: "ارسال نشد.",
  copy: "کپی متن",
  copied: "کپی شد",
  broaden: "بزرگ‌تر انتخاب کن",
  wholePageLabel: "کل صفحه",
  tooBig: "عکس خیلی سنگین است — یکی کوچک‌تر امتحان کن.",
  badImage: "این عکس خوانده نشد.",
  empty: "اول یک چیزی بنویس.",
  intro: "حالت بازبینی — روی هرچیزی بزن و یادداشت بگذار.",
  countOne: "۱ یادداشت فرستاده شد",
  countMany: "{n} یادداشت فرستاده شد",
  regionLabel: "حالت بازبینی",
  more: "بیشتر"
};

/** Every locale the kit ships, by the language subtag it answers to. Adding
    one is a table here and nothing per-site — which is the arithmetic that
    moved this file into the kit. */
export const widgetLocales: Record<string, WidgetStrings> = { en: defaultStrings, fr, fa };

/** The table for a BCP-47 tag, by primary subtag: `fa-IR` and `FA` both find
    Farsi, and anything unlisted falls back to English rather than to blanks.
    Both forks matched on `indexOf("fa") === 0`, which also matched `fao` —
    harmless there and wrong in general, so this splits the tag properly. */
export function stringsFor(lang: string | null | undefined): WidgetStrings {
  const primary = (lang ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
  return widgetLocales[primary] ?? defaultStrings;
}

/** The locale table for `<html lang>`, with a site's overrides on top. The
    order is the point: a site translating one word into a language the kit
    already ships keeps the other twenty-seven. */
export function widgetStrings(
  lang: string | null | undefined,
  overrides?: Partial<WidgetStrings>
): WidgetStrings {
  return { ...stringsFor(lang), ...overrides };
}

/** `fill("{n} notes sent", { n: 3 })`. Absent keys are left as they are, so a
    half-translated string reads as a template rather than as a gap.

    The editor has the same four lines and they stay separate: the widget
    compiles as its own DOM-only ES2017 project (`tsconfig.widget.json`), and
    importing from the server project to save four lines would drag its module
    graph into a chunk that public review links fetch. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = values[key];
    return value === undefined ? whole : String(value);
  });
}
