/* The editor's web app manifest.
   ---------------------------------------------------------------------------
   Generated per site, because almost every field in it is the site's: an owner
   installing this to their home screen should end up with an icon that says
   their name, not one that says ours. The console's manifest is hand-written
   and says "sk Fleet" because there is exactly one of it; there are six of
   these and there will be twenty.

   **`scope` is the editor's route and nothing above it.** That is the one field
   where the manifest and the service worker deliberately disagree, and the
   disagreement is the design: the worker takes root scope because the bundle
   it must cache lives at `/_astro/` (see `worker.ts`), while the manifest's
   scope decides what the *installed app* treats as being inside itself. Scope
   `/` would mean an owner who taps a link to their own home page stays inside
   the app frame, with no address bar, wondering how to get out. Scope `/edit`
   means that link opens their browser, which is what they meant by tapping it.

   The name is not localised and cannot usefully be: a manifest is one static
   file chosen at build time, and the editor picks its language per reader at
   runtime. So the name is the site's own — a proper noun in any language — and
   the only English in it is a word the site supplies. */

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

export interface EditorManifestOptions {
  /** What the installed app is called in full. */
  name: string;
  /** What fits under an icon. Home screens truncate hard at about 12
      characters, so a site that does not say gets the name and the platform's
      own ellipsis rather than a guess that cuts a word in half. */
  shortName?: string;
  /** The editor's route — both `start_url` and `scope`. */
  editorPath: string;
  themeColor?: string;
  backgroundColor?: string;
  /** Falls back to whatever icon the site already ships, found by the
      integration reading `publicDir`. A site that ships none gets a manifest
      with no icons, which is a manifest no browser will offer to install —
      correct, and better than naming a file that 404s. */
  icons?: ManifestIcon[];
  description?: string;
}

export interface EditorManifest {
  name: string;
  short_name: string;
  id: string;
  start_url: string;
  scope: string;
  display: string;
  orientation: string;
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
  description?: string;
}

export function editorManifest(options: EditorManifestOptions): EditorManifest {
  const path = options.editorPath.replace(/\/+$/, "") || "/edit";
  return {
    name: options.name,
    short_name: options.shortName || options.name,
    /* `id` pinned to the route rather than left to default. A manifest with no
       id is identified by its `start_url`, so the day a site changes where its
       editor answers, every already-installed copy would be treated as a
       different app and silently orphaned on somebody's home screen. */
    id: path,
    start_url: path,
    scope: path,
    display: "standalone",
    orientation: "any",
    background_color: options.backgroundColor || "#ffffff",
    theme_color: options.themeColor || "#ffffff",
    icons: options.icons ?? [],
    ...(options.description ? { description: options.description } : {})
  };
}
