/* The content endpoint.
   ---------------------------------------------------------------------------
   GET  ?collection=&entry=   the form model, the current values, the blob sha
   GET  (no params)           the collections and entries this site exposes
   POST {collection, entry, edits, sha}   validate, commit, report the commit

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
import { ConflictError, listEntries, readFile, writeFile, type RepoAccess } from "./contents.js";
import { formModel } from "./form.js";
import { applyEdits, readValues, type Edit } from "./yaml.js";
import { readSession, type Session } from "./session.js";
import { allows } from "./allowlist.js";
import type { CmsEnv, CollectionConfig, ContentHandlerOptions } from "./types.js";

export interface ContentHandler {
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
}

/* An entry name becomes a file path, so it is checked rather than trusted:
   anything but a plain name could climb out of the collection's directory. */
const ENTRY = /^[a-z0-9][a-z0-9._-]*$/i;

export function createContentHandler(options: ContentHandlerOptions): ContentHandler {
  const resolveEnv: () => CmsEnv =
    typeof options.env === "function" ? options.env : () => options.env as CmsEnv;
  const userAgent = options.userAgent ?? "sk-cms";

  async function GET(request: Request): Promise<Response> {
    const env = resolveEnv();
    const gate = await authorize(request, env, false);
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
      /* No collection named: the panel is asking what there is to edit. */
      if (!name) {
        const collections = [];
        for (const [key, config] of Object.entries(options.collections)) {
          collections.push({
            name: key,
            label: config.label ?? key,
            entries: config.dir ? await listEntries(config.dir, access) : [entryOf(config)]
          });
        }
        return json({ ok: true, who: gate.session?.email, collections });
      }

      const config = options.collections[name];
      if (!config) return json({ ok: false, error: "Unknown collection." }, 404);

      const entry = url.searchParams.get("entry") ?? entryOf(config);
      if (!ENTRY.test(entry)) return json({ ok: false, error: "Bad entry name." }, 400);

      const path = filePath(config, entry);
      const file = await readFile(path, access);
      if (!file) return json({ ok: false, error: "That entry doesn't exist." }, 404);

      return json({
        ok: true,
        collection: name,
        entry,
        path,
        sha: file.sha,
        fields: formModel(config.schema, { ...(config.omit ? { omit: config.omit } : {}) }),
        values: readValues(file.text)
      });
    } catch (error) {
      console.error("cms GET failed:", (error as Error).message);
      return json({ ok: false, error: "Couldn't load that content." }, 502);
    }
  }

  async function POST(request: Request): Promise<Response> {
    const env = resolveEnv();
    const gate = await authorize(request, env, true);
    if (gate.response) return gate.response;
    const session = gate.session as Session;

    let payload: {
      collection?: string;
      entry?: string;
      edits?: Edit[];
      sha?: string;
    };
    try {
      payload = (await request.json()) as typeof payload;
    } catch {
      return json({ ok: false, error: "Malformed request." }, 400);
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

    let updated: string;
    try {
      updated = applyEdits(current.text, edits);
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
      const written = await writeFile(
        path,
        { text: updated, sha: payload.sha, message: commitMessage(path, edits, session) },
        access
      );
      return json({ ok: true, sha: written.sha, commit: written.commit });
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

/* --- the gate --------------------------------------------------------- */

interface Gate {
  response?: Response;
  session?: Session;
}

async function authorize(request: Request, env: CmsEnv, checkOrigin: boolean): Promise<Gate> {
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

  return { session };
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

/** Readable in `git log` without opening the diff, and it names the human even
    though the commit is authored by the App. */
function commitMessage(path: string, edits: Edit[], session: Session): string {
  const file = path.replace(/^.*\//, "");
  const paths = edits.map((edit) => edit.path);
  const shown = paths.slice(0, 3).join(", ");
  const rest = paths.length > 3 ? `, and ${paths.length - 3} more` : "";
  return `Edit ${file}: ${shown}${rest}\n\nChanged by ${session.name} <${session.email}> through the site editor.`;
}
