/* Which sections of a page are on the site.
   ---------------------------------------------------------------------------
   PLAN §3.9 draws the discipline line here: *whether a section the designer
   built appears at all* is content and therefore the owner's; creating one,
   moving one, or changing how one looks is still a `content-request` issue. So
   a hideable section carries `visible: z.boolean().default(true)` and the
   template asks before rendering.

   Two things are deliberately not CSS. A section hidden with a class is still
   in the HTML, where a search engine indexes it and anyone reading source can
   read it — which is not what "hide this" means to the person asking. And a
   nav link pointing at a section that is not there scrolls nowhere, silently,
   on the one page an owner is most likely to look at afterwards.

   The second of those is why this file exists at all rather than being three
   lines in each site. Skipping a section is one `{visible && …}` in a
   template and nothing can go wrong with it; *keeping the navigation honest*
   is a rule with an off-by-one in it, and four sites — twenty later — each
   writing their own version of that rule is how one of them ends up wrong.
   Markup stays the site's. The rule is the kit's.

   Pure: no DOM, no fetch, no Astro, and no `yaml`. It runs at build time
   inside a template, which is the one place in the kit that is neither the
   server half nor the browser half, so it must assume neither — and it has
   its own `@shaahink/sitekit/visibility` entry point so a Nav.astro reaching
   for one filter does not pull the content handler and its dependency in
   behind it. */

/** The field a section carries to say whether it is on the site. */
export const VISIBLE = "visible";

/** Is the section at `path` showing?

    Absent means yes, and that is the whole of the safe default: a section
    without the field cannot be hidden, existing content files need no
    migration, and a typo in a path reads as "show it" rather than as
    "silently drop it from the page". The only value that hides anything is a
    literal `false`.

    `path` is dotted, and omitting it asks about the document itself — which
    always answers yes, since a page that could hide itself is not a thing the
    schema is allowed to describe. */
export function isVisible(values: unknown, path?: string): boolean {
  const section = path ? at(values, path) : values;
  if (section === null || section === undefined || typeof section !== "object") return true;
  return (section as Record<string, unknown>)[VISIBLE] !== false;
}

/** The items whose section is showing, in order.

    This is the nav, and the skip links, and any "three chapters" list built
    from the same sections. An item that names no section is always kept: a
    link to another page has nothing to do with this page's visibility, and
    dropping it would be the worse failure of the two.

    ```ts
    const links = visibleOnly(
      [
        { href: "#works", label: "Works", section: "works" },
        { href: "#partners", label: "Partners", section: "partners" },
        { href: "/about", label: "About" }
      ],
      page.data
    );
    ```

    `section` is read off the item by default; pass `of` when the list already
    means something else by that word. */
export function visibleOnly<T>(
  items: readonly T[],
  values: unknown,
  of: (item: T) => string | undefined = (item) => (item as { section?: string }).section
): T[] {
  return items.filter((item) => {
    const path = of(item);
    return path === undefined ? true : isVisible(values, path);
  });
}

/** Every hideable section that is currently off, by path — for a build-time
    report, and for a template that wants to say "two sections are hidden"
    somewhere only the owner can see. Walks objects only; an array row's own
    `visible` is reported with its index, since that is the path an edit would
    use. */
export function hiddenSections(values: unknown, prefix = ""): string[] {
  const out: string[] = [];
  if (values === null || typeof values !== "object") return out;

  for (const [key, child] of entriesOf(values)) {
    const path = join(prefix, key);
    if (child === null || typeof child !== "object") continue;
    if (!Array.isArray(child) && (child as Record<string, unknown>)[VISIBLE] === false) {
      out.push(path);
      /* No recursion into a section that is already off: a subsection of
         something invisible is not separately hidden, and listing it would
         invite an owner to turn it "back on" with no effect. */
      continue;
    }
    out.push(...hiddenSections(child, path));
  }
  return out;
}

function entriesOf(values: object): Array<[string | number, unknown]> {
  return Array.isArray(values)
    ? values.map((item, index) => [index, item] as [number, unknown])
    : Object.entries(values as Record<string, unknown>);
}

/** `works.images[0]`, not `works.images.0` — the spelling every path in the
    editor uses, so a path out of here can be pasted straight into an edit. */
function join(prefix: string, key: string | number): string {
  if (typeof key === "number") return `${prefix}[${key}]`;
  return prefix ? `${prefix}.${key}` : key;
}

function at(values: unknown, path: string): unknown {
  let current: unknown = values;
  for (const segment of path.split(".")) {
    const match = /^([^[\]]*)((?:\[\d+\])*)$/.exec(segment);
    if (!match) return undefined;
    const name = match[1] ?? "";
    if (name) current = step(current, name);
    for (const [, index] of (match[2] ?? "").matchAll(/\[(\d+)\]/g)) {
      current = step(current, Number(index));
    }
  }
  return current;
}

function step(value: unknown, key: string | number): unknown {
  if (value === null || value === undefined || typeof value !== "object") return undefined;
  return (value as Record<string | number, unknown>)[key];
}
