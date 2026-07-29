/* The content endpoint.
   ---------------------------------------------------------------------------
   GET  ?collection=&entry=   the form model, the current values, the blob sha
   GET  (no params)           the collections and entries this site exposes
   GET  ?home                 the owner's home: traffic, recent changes,
                              whether the last one is live, their review link
   POST {collection, entry, edits, sha}   validate, commit, report the commit
   POST {request: {text, page}}           file a content request as an issue

   The last two of those arrived with 7.7 and are here rather than in an
   endpoint of their own for one reason: a second `api/` file is a second file
   in every site repo, and the last per-site editor file cost four client-repo
   commits in an afternoon (SCALE.md §9). A site gains no file for the owner's
   home.

   Two rules here are load-bearing:

   The whole document is re-validated after the edits are applied, never the
   individual fields. A field-level check would let a client send values that
   are each fine and collectively wrong — and the schema guarantee is the only
   thing standing between an owner's typo and a broken build.

   The blob `sha` the edit was based on travels with the write. Without it, two
   tabs — or two owners — silently overwrite each other. With it, the second
   one gets told to reload. */

import { installationToken } from "../feedback/app-auth.js";
import { sameHost } from "../feedback/guards.js";
import { json } from "../feedback/http.js";
import {
  ConflictError,
  listEntries,
  readBinary,
  readFile,
  writeFile,
  type RepoAccess
} from "./contents.js";
import { commitFiles } from "./tree.js";
import { prepareUploads, resolveUploads, UploadError, type PreparedUpload } from "./uploads.js";
import { formModel } from "./form.js";
import { imageType, previewPaths } from "./preview.js";
import { findField, valueAt } from "../editor/values.js";
import type { Field } from "./fields.js";
import { ownerHome } from "./home.js";
import { fileRequest, RequestError } from "./requests.js";
import { applyEdits, readValues, type Edit } from "./yaml.js";
import { readSession, renewSession, type Session } from "./session.js";
import { allows } from "./allowlist.js";
import type { CmsEnv, CollectionConfig, ContentHandlerOptions } from "./types.js";

export interface ContentHandler {
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
}

/* An entry name becomes a file path, so it is checked rather than trusted:
   anything but a plain name could climb out of the collection's directory. */
const ENTRY = /^[a-z0-9][a-z0-9._-]*$/i;

/** Where photographs land when a collection hasn't said. Under `public/`,
    because that is where Astro serves static files from and the URL written
    into the content is this path with its first segment removed. */
const DEFAULT_IMAGE_DIR = "public/images/uploads";

export function createContentHandler(options: ContentHandlerOptions): ContentHandler {
  const resolveEnv: () => CmsEnv =
    typeof options.env === "function" ? options.env : () => options.env as CmsEnv;
  const userAgent = options.userAgent ?? "sk-cms";

  async function GET(request: Request): Promise<Response> {
    const env = resolveEnv();
    const gate = await authorize(request, env, false, options.sessionMaxAge);
    if (gate.response) return gate.response;

    const url = new URL(request.url);
    const name = url.searchParams.get("collection");
    let access: RepoAccess;
    try {
      access = await repoAccess(env, userAgent);
    } catch (error) {
      console.error("cms: credential resolution failed:", (error as Error).message);
      return json({ ok: false, error: "The editor can't reach the repository." }, 502);
    }

    try {
      /* The owner's home: their traffic, their recent changes, whether the
         last one is live, and the review link they were sent separately. It
         hangs off this route rather than one of its own so that no site gains
         a file — see home.ts. */
      if (url.searchParams.get("home") !== null) {
        const home = await ownerHome(access, options.collections, env, {
          ...(options.umamiWebsiteId ? { umamiWebsiteId: options.umamiWebsiteId } : {}),
          userAgent
        });
        return withGate(json({ ok: true, who: gate.session?.email, ...home }), gate);
      }

      /* No collection named: the panel is asking what there is to edit. */
      if (!name) {
        const collections = [];
        for (const [key, config] of Object.entries(options.collections)) {
          const ids = config.dir ? await listEntries(config.dir, access) : [entryOf(config)];
          collections.push({
            name: key,
            label: config.label ?? key,
            entries: ids.map((id) => ({
              id,
              label: config.entryLabels?.[id] ?? id,
              ...(entryUrl(config, id) ? { url: entryUrl(config, id) } : {})
            }))
          });
        }
        return withGate(json({ ok: true, who: gate.session?.email, collections }), gate);
      }

      const config = options.collections[name];
      if (!config) return json({ ok: false, error: "Unknown collection." }, 404);

      const entry = url.searchParams.get("entry") ?? entryOf(config);
      if (!ENTRY.test(entry)) return json({ ok: false, error: "Bad entry name." }, 400);

      const path = filePath(config, entry);
      const file = await readFile(path, access);
      if (!file) return json({ ok: false, error: "That entry doesn't exist." }, 404);

      const fields = formModel(config.schema, { ...(config.omit ? { omit: config.omit } : {}) });
      const values = readValues(file.text);

      /* The picture behind one image field, served out of the repository. Only
         reached when the browser could not load the stored `src` itself — see
         preview.ts, and the picker in editor/render.ts for the fallback. It is
         a branch of this route rather than an endpoint of its own for the same
         reason `?home` is: a second `api/` file is a second file in six site
         repos. */
      const wanted = url.searchParams.get("preview");
      if (wanted !== null) return preview(wanted, fields, values, path, access);

      return withGate(
        json({
          ok: true,
          collection: name,
          entry,
          path,
          sha: file.sha,
          fields,
          values
        }),
        gate
      );
    } catch (error) {
      console.error("cms GET failed:", (error as Error).message);
      return json({ ok: false, error: "Couldn't load that content." }, 502);
    }
  }

  async function POST(request: Request): Promise<Response> {
    const env = resolveEnv();
    const gate = await authorize(request, env, true, options.sessionMaxAge);
    if (gate.response) return gate.response;
    const session = gate.session as Session;

    let payload: {
      collection?: string;
      entry?: string;
      edits?: Edit[];
      sha?: string;
      /** Photographs the panel encoded, referred to from `edits` as
          `upload:<id>`. The client never names a repository path — see
          uploads.ts for why that is the whole shape of this. */
      uploads?: unknown;
      /** "Ask for something bigger" — a different kind of save entirely, and
          the only POST here that writes nothing to the content. */
      request?: { text?: string; page?: string };
    };
    try {
      payload = (await request.json()) as typeof payload;
    } catch {
      return json({ ok: false, error: "Malformed request." }, 400);
    }

    if (payload.request) {
      let access: RepoAccess;
      try {
        access = await repoAccess(env, userAgent);
      } catch (error) {
        console.error("cms: credential resolution failed:", (error as Error).message);
        return json({ ok: false, error: "The editor can't reach the repository." }, 502);
      }
      try {
        const filed = await fileRequest(
          access,
          {
            text: payload.request.text ?? "",
            ...(payload.request.page ? { page: payload.request.page } : {}),
            who: { name: session.name, email: session.email }
          },
          options.requestLabel
        );
        return withGate(json({ ok: true, request: filed }), gate);
      } catch (error) {
        if (error instanceof RequestError) {
          return json({ ok: false, error: error.message }, 400);
        }
        console.error("cms request failed:", (error as Error).message);
        return json({ ok: false, error: "Couldn't send that just now. Your words are still here." }, 502);
      }
    }

    const config = payload.collection ? options.collections[payload.collection] : undefined;
    if (!config) return json({ ok: false, error: "Unknown collection." }, 404);

    const entry = payload.entry ?? entryOf(config);
    if (!ENTRY.test(entry)) return json({ ok: false, error: "Bad entry name." }, 400);

    const edits = payload.edits;
    if (!Array.isArray(edits) || !edits.length) {
      return json({ ok: false, error: "Nothing to save." }, 400);
    }
    if (!payload.sha) {
      return json({ ok: false, error: "Missing the version this edit was based on." }, 400);
    }

    let access: RepoAccess;
    try {
      access = await repoAccess(env, userAgent);
    } catch (error) {
      console.error("cms: credential resolution failed:", (error as Error).message);
      return json({ ok: false, error: "The editor can't reach the repository." }, 502);
    }

    const path = filePath(config, entry);
    let current;
    try {
      current = await readFile(path, access);
    } catch (error) {
      console.error("cms POST read failed:", (error as Error).message);
      return json({ ok: false, error: "Couldn't load that content." }, 502);
    }
    if (!current) return json({ ok: false, error: "That entry doesn't exist." }, 404);

    /* Checked here as well as at the write, so the common case gets the
       readable message instead of GitHub's status code. */
    if (current.sha !== payload.sha) {
      return json(
        { ok: false, error: "Someone else edited this since you opened it — reload and try again." },
        409
      );
    }

    /* Photographs, if any: validated and given their repository paths here,
       then substituted into the edits that referred to them. Nothing is
       written yet — a save that fails validation must not leave orphan blobs
       behind, so every file goes in the same commit as the content or not at
       all. */
    let uploads: PreparedUpload[];
    try {
      uploads = await prepareUploads(
        payload.uploads,
        config.imageDir ?? DEFAULT_IMAGE_DIR,
        options.uploadLimits ?? {}
      );
    } catch (error) {
      if (error instanceof UploadError) return json({ ok: false, error: error.message }, 400);
      throw error;
    }

    let resolved: Edit[];
    try {
      resolved = edits.map((edit) => ({ path: edit.path, value: resolveUploads(edit.value, uploads) }));
    } catch (error) {
      if (error instanceof UploadError) return json({ ok: false, error: error.message }, 400);
      throw error;
    }

    /* An upload nothing refers to would be committed and then be an orphan
       from its first second — no row pointing at it, nothing to find it by.
       Decision 3 accepts orphans left behind by a *deletion*, where the file
       was referenced once and the history remembers it; this is a different
       thing, and it is a fault in the caller rather than something an owner
       did. */
    const referring = JSON.stringify(resolved);
    if (uploads.some((upload) => !referring.includes(JSON.stringify(upload.url)))) {
      return json({ ok: false, error: "Malformed request." }, 400);
    }

    let updated: string;
    try {
      updated = applyEdits(current.text, resolved);
    } catch (error) {
      console.error("cms: applying edits failed:", (error as Error).message);
      return json({ ok: false, error: "Couldn't apply that change." }, 400);
    }

    /* The whole document, against the same schema the build uses. */
    const parsed = config.schema.safeParse(readValues(updated));
    if (!parsed.success) {
      return json(
        {
          ok: false,
          error: "That change doesn't fit the content model.",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message
          }))
        },
        400
      );
    }

    try {
      const message = commitMessage(path, edits, session, uploads.length);
      /* A save that carries files goes through the Git Data API so the image
         and the row that points at it land together — see tree.ts. Text-only
         saves stay on the Contents API: it is the common case, it already
         works, and its `sha` parameter is the concurrency check for free. */
      const written = uploads.length
        ? await commitFiles(
            [
              { path, text: updated },
              ...uploads.map((upload) => ({ path: upload.path, base64: upload.base64 }))
            ],
            { message, expect: { path, sha: payload.sha } },
            access
          )
        : await writeFile(path, { text: updated, sha: payload.sha, message }, access);
      return withGate(json({ ok: true, sha: written.sha, commit: written.commit }), gate);
    } catch (error) {
      if (error instanceof ConflictError) {
        return json(
          { ok: false, error: "Someone else edited this since you opened it — reload and try again." },
          409
        );
      }
      console.error("cms: commit failed:", (error as Error).message);
      return json({ ok: false, error: "Couldn't save that change." }, 502);
    }
  }

  return { GET, POST };
}

/* --- the picker's preview ---------------------------------------------- */

/** The photograph one image field currently points at, as bytes.

    Every 404 here is deliberately the same sentence in the same shape as a
    missing entry: this route is behind the owner's session, but a 404 that
    distinguished "no such field" from "no such file" would still be answering
    questions about the inside of a private repository. */
async function preview(
  wanted: string,
  fields: Field[],
  values: unknown,
  entryPath: string,
  access: RepoAccess
): Promise<Response> {
  const missing = json({ ok: false, error: "There's no picture there." }, 404);

  /* An image field, found the way the annotation checker finds one, so
     `slides[2].src` matches the `slides[].src` the schema describes. Any other
     kind of field is a refusal: the whole guard against this becoming a way to
     read a repository is that only a picture's own path can be asked for. */
  const field = findField(fields, wanted);
  if (!field || field.kind !== "image") return missing;

  const src = valueAt(values, wanted);
  if (typeof src !== "string") return missing;

  const type = imageType(src);
  if (!type) return missing;

  for (const candidate of previewPaths(src, entryPath)) {
    let found;
    try {
      found = await readBinary(candidate, access);
    } catch (error) {
      console.error("cms preview failed:", (error as Error).message);
      return json({ ok: false, error: "Couldn't load that picture." }, 502);
    }
    if (!found) continue;
    return new Response(found.bytes, {
      headers: {
        "content-type": type,
        /* An SVG off the site's own origin is a document that could carry
           script. It cannot need any of it to draw a picture. */
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
        "x-content-type-options": "nosniff",
        /* One owner, one photograph they are in the middle of replacing. A
           cached preview of the picture they just changed is worse than a
           second request. */
        "cache-control": "private, no-store"
      }
    });
  }
  return missing;
}

/* --- the gate --------------------------------------------------------- */

interface Gate {
  response?: Response;
  session?: Session;
  /** A `Set-Cookie` to append if the session was renewed on this request. */
  cookie?: string;
}

async function authorize(
  request: Request,
  env: CmsEnv,
  checkOrigin: boolean,
  maxAgeSeconds?: number
): Promise<Gate> {
  if (!env.sessionSecret || !env.repo || !hasCredential(env)) {
    return { response: json({ ok: false, error: "The editor is not configured yet." }, 503) };
  }

  if (checkOrigin) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (!origin || !sameHost(origin, host, env.allowedOrigin)) {
      return { response: json({ ok: false, error: "Bad origin." }, 403) };
    }
  }

  const session = await readSession(request.headers.get("cookie"), { secret: env.sessionSecret });
  if (!session) return { response: json({ ok: false, error: "Sign in to edit." }, 401) };

  /* Re-checked on every request, not just at sign-in: removing someone from
     the allowlist should take effect now, not whenever their cookie lapses. */
  if (!allows(env.allowlist, session)) {
    return { response: json({ ok: false, error: "That account can't edit this site." }, 403) };
  }

  /* Renewed after the allowlist check, never before: a removed account must
     not be handed a fresh hour on its way out. */
  const cookie = await renewSession(session, {
    secret: env.sessionSecret,
    ...(maxAgeSeconds !== undefined ? { maxAgeSeconds } : {})
  });

  return { session, ...(cookie ? { cookie } : {}) };
}

/** Attach a renewed session cookie, if the gate minted one. */
function withGate(response: Response, gate: Gate): Response {
  if (!gate.cookie) return response;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", gate.cookie);
  return new Response(response.body, { status: response.status, headers });
}

function hasCredential(env: CmsEnv): boolean {
  return Boolean(env.token || (env.appId && env.appPrivateKey && env.appInstallationId));
}

async function repoAccess(env: CmsEnv, userAgent: string): Promise<RepoAccess> {
  const token =
    env.appId && env.appPrivateKey && env.appInstallationId
      ? await installationToken({
          appId: env.appId,
          privateKey: env.appPrivateKey,
          installationId: env.appInstallationId,
          userAgent
        })
      : (env.token as string);
  return { repo: env.repo as string, token, userAgent, branch: env.branch };
}

/* --- paths and messages ----------------------------------------------- */

function entryOf(config: CollectionConfig): string {
  return (config.file ?? "").replace(/^.*\//, "").replace(/\.ya?ml$/, "");
}

function filePath(config: CollectionConfig, entry: string): string {
  if (config.dir) return `${config.dir.replace(/\/+$/, "")}/${entry}.yaml`;
  return config.file as string;
}

/** Where an entry can be seen on the site, so the panel can offer to go and
    edit it in place. A pattern covers a collection whose URLs are regular
    (`/projects/{entry}.html`); a map covers one whose aren't.

    Only a site-relative path is ever emitted. This value ends up as an href
    the owner taps, so an absolute URL here would be a link off the site
    wearing the editor's clothes — refused rather than trusted, even though
    the only writer is the site's own config. */
function entryUrl(config: CollectionConfig, id: string): string | undefined {
  const raw =
    typeof config.entryUrl === "string"
      ? config.entryUrl.replace("{entry}", id)
      : config.entryUrl?.[id];
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return undefined;
  return raw;
}

/** Readable in `git log` without opening the diff, and it names the human even
    though the commit is authored by the App. */
function commitMessage(path: string, edits: Edit[], session: Session, files = 0): string {
  const file = path.replace(/^.*\//, "");
  const paths = edits.map((edit) => edit.path);
  const shown = paths.slice(0, 3).join(", ");
  const rest = paths.length > 3 ? `, and ${paths.length - 3} more` : "";
  /* Said in the subject rather than left to the diff: a commit that adds a
     megabyte of photographs should look like one in `git log`. */
  const pictures = files ? ` (+${files} ${files === 1 ? "picture" : "pictures"})` : "";
  return `Edit ${file}: ${shown}${rest}${pictures}\n\nChanged by ${session.name} <${session.email}> through the site editor.`;
}
