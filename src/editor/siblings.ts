/* The same page in the other language.
   ---------------------------------------------------------------------------
   `cms/types.ts` has said since the editor existed that *"the one mistake the
   editor must not make easy is editing the wrong locale believing it is the
   right one"* — and until 0.20.0 the only thing preventing it was a label.
   Nothing in the kit knew what a locale was.

   Nothing here declares one either, and that is the design. **The sites
   already spell it**: an entry id is `<stem>.<locale>` on the two bilingual
   sites in the fleet and a plain name on the other five, so a sibling is *the
   same collection, the same stem, a different final dot-segment*. The human
   name for it is already in `entryLabels` — "English", "Français", "فارسی", in
   the site's own words — and `entryUrl` already knows where it lives. This is
   the kit reading a picture from its shape, applied to an entry id: site
   twenty gets it by spelling its entries the way `site-template`'s comment
   already tells it to, and no site gains a line of configuration.

   Measured across all seven checkouts on 2026-07-31, which is what makes the
   next paragraph a fact rather than a hope:

     elfine-site   8 collections × X.en / X.fr        16 dotted ids
     nimagiti      pages → home.en, home.fa            2 dotted ids
     the other five                                    0 dotted ids

   So on five of seven sites this cannot fire at all, which is the property
   that makes it safe to ship fleet-wide with no flag and no opt-in.

   **The locale has to look like one.** `01-100kolah` has no dot and is safe by
   that alone, but `v1.2-notes` would split into a stem and a "locale" of
   `2-notes` and the panel would offer an owner a page in a language that does
   not exist. So the final segment is required to look like a BCP-47 language
   tag, which is the shape the thing being detected actually has.

   It lives in `src/editor` rather than in `src/cms` for a build reason worth
   writing down: `tsconfig.editor.json` includes `src/editor` alone, so an
   editor file can take a *type* from the cms but cannot call into it. That is
   also why there is no server side to this at all — the panel is already given
   every collection and every entry when it signs in, so deriving the answer in
   the browser costs no request, no payload and no second place for the rule to
   live. */

/** A final dot-segment that looks like a language tag: two or three letters,
    then any number of `-`-joined subtags. `en`, `fa`, `pt-br`, `zh-hant` yes;
    `2-notes`, `yaml`, `v1` no. */
const LOCALE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

/** What the panel is handed for every entry of every collection — the shape
    the content route's "what is there to edit" answer already has. */
export interface EntryRef {
  id: string;
  label: string;
  url?: string;
}

/** `home.en` → `{ stem: "home", locale: "en" }`. Null for an id with no dot,
    or one whose last segment is not language-shaped. */
export function splitLocale(id: string): { stem: string; locale: string } | null {
  const dot = id.lastIndexOf(".");
  if (dot <= 0 || dot === id.length - 1) return null;
  const locale = id.slice(dot + 1);
  if (!LOCALE.test(locale)) return null;
  return { stem: id.slice(0, dot), locale };
}

/** The other languages of one entry, in the order the collection lists them.

    Empty whenever the question does not apply: an entry with no locale in its
    id, a collection where nothing else shares the stem, or a stem-mate whose
    own suffix is not language-shaped. An empty answer takes the line off the
    panel, which is the same rule `entryUrl` follows — an offer that cannot be
    kept is worse than no offer. */
export function siblingsOf(id: string, entries: EntryRef[]): EntryRef[] {
  const here = splitLocale(id);
  if (!here) return [];
  return entries.filter((entry) => {
    if (entry.id === id) return false;
    const other = splitLocale(entry.id);
    return other !== null && other.stem === here.stem;
  });
}
