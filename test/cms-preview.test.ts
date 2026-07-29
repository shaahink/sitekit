/* The picker's preview of a photograph the site does not serve.
   ---------------------------------------------------------------------------
   The bug this covers was measured in a browser rather than found here: on
   nimagiti every image control drew a 2px broken-image hairline, because his
   content points at `/src/assets/images/...` and `astro:assets` resolves that
   at build time into a hashed file nothing serves under its stored name.

   Two halves are testable without a browser and both are here — where in the
   repository a stored `src` could be, and the route that answers with the
   bytes. The third, an `<img>` falling back to that route when the direct load
   fails, is DOM and is proved in a real browser like the rest of the panel. */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod";
import { createContentHandler } from "../src/cms/handler.js";
import { imageType, previewPaths } from "../src/cms/preview.js";
import { issueSession } from "../src/cms/session.js";
import { normalize } from "../src/cms/yaml.js";

describe("previewPaths", () => {
  const entry = "src/content/pages/home.en.yaml";

  it("reads a leading slash both ways the fleet spells it", () => {
    /* nimagiti: repository-relative, resolved by astro:assets at build time. */
    expect(previewPaths("/src/assets/images/hero-teal.jpg", entry)).toEqual([
      "src/assets/images/hero-teal.jpg",
      "public/src/assets/images/hero-teal.jpg"
    ]);
    /* bez and the template: a URL the site serves, which is `public/` + path
       in the repository — the inverse of what uploads.ts writes. */
    expect(previewPaths("/images/uploads/garden.jpg", entry)).toEqual([
      "images/uploads/garden.jpg",
      "public/images/uploads/garden.jpg"
    ]);
  });

  it("resolves a relative path against the content file, dots and all", () => {
    expect(previewPaths("../../assets/photos/bass.jpg", entry)).toEqual(["src/assets/photos/bass.jpg"]);
    expect(previewPaths("./beside.png", entry)).toEqual(["src/content/pages/beside.png"]);
    expect(previewPaths("beside.png", entry)).toEqual(["src/content/pages/beside.png"]);
  });

  it("refuses a path that climbs out of the repository rather than clamping it", () => {
    expect(previewPaths("../../../../../etc/passwd", entry)).toEqual([]);
    expect(previewPaths("/../secrets.jpg", entry)).toEqual([]);
  });

  it("has nothing to add to an absolute URL, a data URI or an unsaved upload", () => {
    expect(previewPaths("https://images.example/x.jpg", entry)).toEqual([]);
    expect(previewPaths("//images.example/x.jpg", entry)).toEqual([]);
    expect(previewPaths("data:image/jpeg;base64,AAAA", entry)).toEqual([]);
    expect(previewPaths("upload:u1", entry)).toEqual([]);
    expect(previewPaths("   ", entry)).toEqual([]);
  });
});

describe("imageType", () => {
  it("names the picture formats and nothing else", () => {
    expect(imageType("a/b.JPG")).toBe("image/jpeg");
    expect(imageType("a/b.jpeg")).toBe("image/jpeg");
    expect(imageType("a/b.png")).toBe("image/png");
    expect(imageType("a/b.webp")).toBe("image/webp");
    expect(imageType("a/b.avif")).toBe("image/avif");
    expect(imageType("a/b.gif")).toBe("image/gif");
    expect(imageType("a/b.svg")).toBe("image/svg+xml");
  });

  it("refuses everything that is not one — this is the guard, not a convenience", () => {
    expect(imageType("src/content/pages/home.en.yaml")).toBeNull();
    expect(imageType("videos/zand.mp4")).toBeNull();
    expect(imageType(".env")).toBeNull();
    expect(imageType("no-extension")).toBeNull();
  });
});

/* --- the route ---------------------------------------------------------- */

const SECRET = "per-site-session-secret";
const HOST = "nimagiti.vercel.app";
const FILE = "src/content/pages/home.en.yaml";

const schema = z.object({
  hero: z.object({
    image: z.object({
      src: z.string(),
      w: z.number().int(),
      h: z.number().int(),
      alt: z.string()
    })
  }),
  film: z.object({
    poster: z.string(),
    src: z.string(),
    w: z.number().int(),
    h: z.number().int()
  })
});

const SOURCE = normalize(`hero:
  image:
    src: "/src/assets/images/hero-teal.jpg"
    w: 1600
    h: 1067
    alt: "A teal wall"

film:
  poster: "/images/still.jpg"
  src: "/videos/zand.mp4"
  w: 1280
  h: 720
`);

const handler = createContentHandler({
  collections: { home: { schema, file: FILE, omit: ["hero.image.w", "hero.image.h"] } },
  env: { sessionSecret: SECRET, allowlist: "shaahin69@gmail.com", token: "ghp_test", repo: "shaahink/nimagiti" }
});

/* The photograph, as GitHub hands one back: base64, wrapped at 60 characters,
   and with a first byte that is JPEG's. */
const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

let asked: string[];
let big: boolean;

beforeEach(() => {
  asked = [];
  big = false;
  vi.stubGlobal("fetch", async (url: string) => {
    const path = new URL(url).pathname;
    asked.push(path);
    if (path.endsWith("/git/blobs/photo-sha")) {
      return jsonResponse({ content: PHOTO.toString("base64"), encoding: "base64" });
    }
    if (path.endsWith(encodeURI(`/contents/${FILE}`))) {
      return jsonResponse({ type: "file", content: Buffer.from(SOURCE, "utf8").toString("base64"), sha: "yaml-sha" });
    }
    if (path.endsWith("/contents/src/assets/images/hero-teal.jpg")) {
      return jsonResponse(
        big
          ? { type: "file", sha: "photo-sha", encoding: "none", content: "" }
          : {
              type: "file",
              sha: "photo-sha",
              encoding: "base64",
              content: PHOTO.toString("base64").replace(/(.{6})/g, "$1\n")
            }
      );
    }
    return jsonResponse({ message: "Not Found" }, 404);
  });
});

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function cookie(): Promise<string> {
  const set = await issueSession(
    { sub: "108134", email: "shaahin69@gmail.com", name: "Shahin Kiassat" },
    { secret: SECRET }
  );
  return set.split(";")[0] as string;
}

async function preview(field: string): Promise<Response> {
  return handler.GET(
    new Request(`https://${HOST}/api/content?collection=home&entry=home&preview=${encodeURIComponent(field)}`, {
      headers: { host: HOST, cookie: await cookie() }
    })
  );
}

describe("GET ?preview", () => {
  it("answers with the bytes of the photograph the field points at", async () => {
    const response = await preview("hero.image.src");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(PHOTO));
    /* The stored path first, and no second guess once it answers. */
    expect(asked.filter((path) => path.includes("hero-teal"))).toEqual([
      "/repos/shaahink/nimagiti/contents/src/assets/images/hero-teal.jpg"
    ]);
  });

  it("follows the blobs API when the contents API is too small to carry the file", async () => {
    /* A photograph in a repository is routinely over the megabyte where the
       contents API stops returning content — treating that as missing would
       have made this work for thumbnails only. */
    big = true;
    const response = await preview("hero.image.src");
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(PHOTO));
    expect(asked).toContain("/repos/shaahink/nimagiti/git/blobs/photo-sha");
  });

  it("refuses a field that is not a picture, whatever it points at", async () => {
    /* `film.src` is a real path in a real field, and its object is `src`+`w`+`h`
       — the shape that used to read as a photograph. Both halves of the guard
       are here: the form model does not call it an image, and .mp4 is not a
       picture's extension. */
    expect((await preview("film.src")).status).toBe(404);
    expect((await preview("film.poster")).status).toBe(404);
    expect(asked.some((path) => path.includes("zand.mp4"))).toBe(false);
  });

  it("refuses a path that is not a field at all, and never asks GitHub for it", async () => {
    expect((await preview("../../.env")).status).toBe(404);
    expect((await preview("hero.image.alt")).status).toBe(404);
    expect((await preview("")).status).toBe(404);
    expect(asked.some((path) => path.includes(".env"))).toBe(false);
  });

  it("is behind the session like everything else on this route", async () => {
    const response = await handler.GET(
      new Request(`https://${HOST}/api/content?collection=home&entry=home&preview=hero.image.src`, {
        headers: { host: HOST }
      })
    );
    expect(response.status).toBe(401);
  });

  it("leaves the form model alone — asking for a preview is not asking for the entry", async () => {
    const body = (await (
      await handler.GET(
        new Request(`https://${HOST}/api/content?collection=home&entry=home`, {
          headers: { host: HOST, cookie: await cookie() }
        })
      )
    ).json()) as { fields: Array<{ path: string; kind: string }> };
    const image = body.fields
      .flatMap((field) => ("fields" in field ? (field as any).fields : [field]))
      .flatMap((field: any) => ("fields" in field ? field.fields : [field]));
    expect(image.find((field: any) => field.path === "hero.image.src")?.kind).toBe("image");
  });
});
