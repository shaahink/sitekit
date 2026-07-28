/* One save, one commit — even when a save is more than one file.
   ---------------------------------------------------------------------------
   Adding a photograph is two files: the image, and the YAML row that points at
   it. Through the Contents API that is two `PUT`s and therefore two commits,
   with a window in between where the content references an image that is not
   in the repository yet. On a static site that window is a deploy, and the
   deploy is the broken one.

   So a save that carries files is assembled as a tree instead: create a blob
   per file, create a tree on top of the current one, create a commit with the
   current head as its parent, then move the ref. Four round trips instead of
   one, in exchange for "a save is a commit" staying literally true, a diff
   that reads as the single action it was, and no torn state at any point.

   Text-only saves keep going through the Contents API (contents.ts). They are
   the common case, they already work, and they carry the blob-`sha`
   concurrency check for free. This path re-creates that check by hand — see
   `expectSha` — because a tree commit has no equivalent parameter.

   §3.4 holds: `fetch` and JSON, nothing host-shaped. */

import { gh } from "../feedback/github.js";
import { ConflictError, type RepoAccess, type WriteResult } from "./contents.js";

export interface TreeFile {
  /** Repository-relative, forward slashes, no leading slash. */
  path: string;
  /** UTF-8 text, or base64 bytes — one or the other, never both. */
  text?: string;
  base64?: string;
}

export interface CommitTreeOptions {
  message: string;
  /** The blob sha the edit was based on, and the path it belongs to. GitHub's
      Contents API takes this as a parameter and refuses the write when it no
      longer matches; the Git Data API has nothing equivalent, so it is checked
      here against the tree the commit is about to be built on. Without it two
      owners — or two tabs — silently overwrite each other, which is the one
      thing the text path has always been careful about. */
  expect?: { path: string; sha: string };
}

/** Commits every file as one commit and returns where it landed. */
export async function commitFiles(
  files: TreeFile[],
  options: CommitTreeOptions,
  access: RepoAccess
): Promise<WriteResult> {
  if (!files.length) throw new Error("commitFiles: nothing to commit");

  const branch = access.branch ?? (await defaultBranch(access));
  const ref = `heads/${branch}`;

  const head = await call(`/repos/${access.repo}/git/ref/${ref}`, access);
  const headSha = head.object?.sha as string;
  const commit = await call(`/repos/${access.repo}/git/commits/${headSha}`, access);
  const baseTree = commit.tree?.sha as string;

  if (options.expect) await checkUnmoved(options.expect, baseTree, access);

  /* Blobs first, and in parallel: a phone photograph and a YAML file have
     nothing to say to each other, and the wait is the owner's. */
  const blobs = await Promise.all(
    files.map(async (file) => {
      const created = await call(`/repos/${access.repo}/git/blobs`, access, {
        method: "POST",
        body:
          file.base64 !== undefined
            ? { content: file.base64, encoding: "base64" }
            : { content: file.text ?? "", encoding: "utf-8" }
      });
      return { path: file.path, sha: created.sha as string };
    })
  );

  const tree = await call(`/repos/${access.repo}/git/trees`, access, {
    method: "POST",
    body: {
      base_tree: baseTree,
      tree: blobs.map((blob) => ({
        path: blob.path,
        /* 100644: a plain non-executable file. Everything the editor writes is
           one, and spelling it out beats inheriting whatever GitHub defaults
           to for a path that already exists with another mode. */
        mode: "100644",
        type: "blob",
        sha: blob.sha
      }))
    }
  });

  const made = await call(`/repos/${access.repo}/git/commits`, access, {
    method: "POST",
    body: { message: options.message, tree: tree.sha, parents: [headSha] }
  });

  /* No `force`. If the branch moved while the blobs were being uploaded — a
     second owner, a Renovate merge — GitHub refuses this as a non-fast-forward
     and the owner is told to reload, rather than the other commit disappearing
     out of the history. */
  const moved = await gh(`/repos/${access.repo}/git/refs/${ref}`, {
    token: access.token,
    userAgent: access.userAgent,
    method: "PATCH",
    body: { sha: made.sha }
  });
  if (moved.status === 422) throw new ConflictError("the branch moved while saving");
  if (!moved.ok) throw new Error(`update ref: ${moved.status} ${moved.text}`);

  return { sha: fileShaOf(blobs, options.expect?.path) ?? (made.sha as string), commit: made.html_url as string };
}

/** The new blob sha for the content file, so the panel can keep saving without
    a reload — the same thing the Contents API hands back. */
function fileShaOf(blobs: Array<{ path: string; sha: string }>, path?: string): string | undefined {
  if (!path) return undefined;
  return blobs.find((blob) => blob.path === path)?.sha;
}

/** Has the file this edit was based on moved since it was read?

    Asked of the tree the commit is about to be built on, which is the only
    version that matters: a check against `HEAD` a moment earlier would be
    answering about a different commit than the one being extended. */
async function checkUnmoved(
  expect: { path: string; sha: string },
  baseTree: string,
  access: RepoAccess
): Promise<void> {
  const tree = await call(
    `/repos/${access.repo}/git/trees/${baseTree}?recursive=1`,
    access
  );
  const entry = (tree.tree as Array<{ path: string; sha: string }> | undefined)?.find(
    (item) => item.path === expect.path
  );
  /* A missing file is a conflict too: it means the entry was deleted or
     renamed under the edit, and writing it back would silently resurrect it. */
  if (!entry || entry.sha !== expect.sha) {
    throw new ConflictError(`${expect.path} moved under the edit`);
  }
}

async function defaultBranch(access: RepoAccess): Promise<string> {
  const repo = await call(`/repos/${access.repo}`, access);
  return (repo.default_branch as string) ?? "main";
}

async function call(
  path: string,
  access: RepoAccess,
  options: { method?: string; body?: unknown } = {}
): Promise<any> {
  const result = await gh(path, {
    token: access.token,
    userAgent: access.userAgent,
    ...(options.method ? { method: options.method } : {}),
    ...(options.body !== undefined ? { body: options.body } : {})
  });
  if (!result.ok) throw new Error(`${path}: ${result.status} ${result.text}`);
  return result.data;
}
