/* The GitHub Contents API, as the editor uses it.
   ---------------------------------------------------------------------------
   Reads and writes go through GitHub rather than the deployment's filesystem:
   a Vercel function's disk is read-only and ephemeral, and the commit is the
   point anyway. Every read carries back the blob `sha`, which is what makes
   optimistic concurrency possible — see the handler.

   Base64 here is deliberately not `btoa(text)`. Half the fleet's content is
   Persian and Arabic, and `btoa` throws on anything outside Latin-1; these go
   through TextEncoder/TextDecoder so the bytes are UTF-8 either way. */

import { gh } from "../feedback/github.js";

export interface RepoAccess {
  repo: string;
  token: string;
  userAgent: string;
  branch?: string | undefined;
}

export interface FileContents {
  text: string;
  sha: string;
}

/** Whether a link to github.com works for somebody who is not signed in there.
    ---------------------------------------------------------------------------
    The owner has a Google account, not a GitHub one, and is not a collaborator
    on their own site's repository. So on a private repo every github.com link
    the panel emits is a "Page not found" for the person it is shown to — which
    is what the 09.6 browser pass measured, five times per panel on "See exactly
    what changed" and once more on the issue a request had just filed.

    Public is the whole predicate: a public repo's commits and issues read
    anonymously, so the link is good for everyone. Failure answers *not* public,
    because a missing link costs a curious owner nothing and a dead one spends
    the trust the panel exists to build. */
export async function repoIsPublic(access: RepoAccess): Promise<boolean> {
  const result = await gh(`/repos/${access.repo}`, {
    token: access.token,
    userAgent: access.userAgent
  });
  if (!result.ok || typeof result.data?.private !== "boolean") return false;
  return result.data.private === false;
}

/** The file, or null if it isn't there. */
export async function readFile(path: string, access: RepoAccess): Promise<FileContents | null> {
  const query = access.branch ? `?ref=${encodeURIComponent(access.branch)}` : "";
  const result = await gh(`/repos/${access.repo}/contents/${encodePath(path)}${query}`, {
    token: access.token,
    userAgent: access.userAgent
  });
  if (result.status === 404) return null;
  if (!result.ok) throw new Error(`read ${path}: ${result.status} ${result.text}`);
  if (result.data?.type !== "file" || typeof result.data.content !== "string") {
    throw new Error(`read ${path}: not a file`);
  }
  return { text: decodeUtf8Base64(result.data.content), sha: result.data.sha as string };
}

/** The `.yaml` entry names in a directory, without extensions. */
export async function listEntries(dir: string, access: RepoAccess): Promise<string[]> {
  const query = access.branch ? `?ref=${encodeURIComponent(access.branch)}` : "";
  const result = await gh(`/repos/${access.repo}/contents/${encodePath(dir)}${query}`, {
    token: access.token,
    userAgent: access.userAgent
  });
  if (result.status === 404) return [];
  if (!result.ok) throw new Error(`list ${dir}: ${result.status} ${result.text}`);
  if (!Array.isArray(result.data)) return [];
  return result.data
    .filter((item: { type?: string; name?: string }) => item.type === "file" && /\.ya?ml$/.test(item.name ?? ""))
    .map((item: { name: string }) => item.name.replace(/\.ya?ml$/, ""))
    .sort();
}

export interface WriteResult {
  sha: string;
  commit: string;
}

/** Commits the file. `sha` must be the blob the edit was based on: GitHub
    rejects the write with a 409 if the file has moved on, which is exactly
    the concurrency check we want and costs one parameter. */
export async function writeFile(
  path: string,
  body: { text: string; sha: string; message: string },
  access: RepoAccess
): Promise<WriteResult> {
  const result = await gh(`/repos/${access.repo}/contents/${encodePath(path)}`, {
    token: access.token,
    userAgent: access.userAgent,
    method: "PUT",
    body: {
      message: body.message,
      content: encodeUtf8Base64(body.text),
      sha: body.sha,
      ...(access.branch ? { branch: access.branch } : {})
    }
  });
  if (result.status === 409 || result.status === 422) {
    throw new ConflictError(`write ${path}: ${result.status}`);
  }
  if (!result.ok) throw new Error(`write ${path}: ${result.status} ${result.text}`);
  return {
    sha: result.data?.content?.sha as string,
    commit: result.data?.commit?.html_url as string
  };
}

/** Thrown when the file moved under the edit — the handler turns it into the
    one error message an owner can actually act on. */
export class ConflictError extends Error {}

/** A file's bytes rather than its text, for the picker's preview of a
    photograph no server serves (preview.ts). Null when it isn't there, which
    is an ordinary answer here: the first path tried is a guess between two
    spellings.

    Two calls in the worst case, and the second one is not optional. The
    contents API stops returning content somewhere around a megabyte and hands
    back `encoding: "none"` with the blob's sha instead — which is exactly the
    size range a photograph in a repository lives in, so treating that as
    "missing" would have made this work only for small pictures. The blobs API
    takes the sha and answers base64 up to 100 MB. */
export async function readBinary(path: string, access: RepoAccess): Promise<FileBytes | null> {
  const query = access.branch ? `?ref=${encodeURIComponent(access.branch)}` : "";
  const result = await gh(`/repos/${access.repo}/contents/${encodePath(path)}${query}`, {
    token: access.token,
    userAgent: access.userAgent
  });
  if (result.status === 404) return null;
  if (!result.ok) throw new Error(`read ${path}: ${result.status} ${result.text}`);
  if (result.data?.type !== "file") throw new Error(`read ${path}: not a file`);

  const sha = result.data.sha as string;
  if (result.data.encoding === "base64" && typeof result.data.content === "string" && result.data.content) {
    return { bytes: decodeBase64(result.data.content), sha };
  }

  const blob = await gh(`/repos/${access.repo}/git/blobs/${sha}`, {
    token: access.token,
    userAgent: access.userAgent
  });
  if (!blob.ok || typeof blob.data?.content !== "string") {
    throw new Error(`read blob ${path}: ${blob.status} ${blob.text}`);
  }
  return { bytes: decodeBase64(blob.data.content), sha };
}

export interface FileBytes {
  /** Named concretely so the buffer satisfies `BodyInit` without a cast. */
  bytes: Uint8Array<ArrayBuffer>;
  sha: string;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  /* GitHub wraps its base64 at 60 characters; `atob` is specified to skip
     whitespace but the payload is stripped anyway, because a decoder that
     depends on forgiveness is a decoder that fails on a different runtime. */
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeUtf8Base64(value: string): string {
  return new TextDecoder().decode(decodeBase64(value));
}

function encodeUtf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
