/* What stands between a browser and a commit.
   ---------------------------------------------------------------------------
   The shape being defended here is that the client never names a repository
   path: it sends `{id, name, dataUrl}` and refers to the result as
   `upload:<id>`. Everything below is either that substitution working, or a
   way in which it must refuse. */

import { describe, expect, it } from "vitest";
import { prepareUploads, resolveUploads, UploadError } from "../src/cms/uploads.js";

/* A one-pixel JPEG is not needed — nothing here decodes the image, and
   pretending otherwise would test the wrong thing. What is checked is the
   envelope. */
const jpeg = (body = "QUJD") => `data:image/jpeg;base64,${body}`;

const one = [{ id: "u1", name: "IMG_4032.HEIC", dataUrl: jpeg() }];

describe("prepareUploads", () => {
  it("puts a file under the collection's directory with a readable name", async () => {
    const [file] = await prepareUploads(one, "public/images/rooms");
    expect(file?.path).toMatch(/^public\/images\/rooms\/img-4032-[0-9a-f]{8}\.jpg$/);
  });

  /* The URL is the path with its first segment dropped, which is Astro's rule
     for `public/`. Getting this wrong writes a `src` for a file the site never
     serves — a broken image that looks like content. */
  it("writes the URL the site will actually serve", async () => {
    const [file] = await prepareUploads(one, "public/images/rooms");
    expect(file?.url).toBe(file?.path.replace(/^public/, ""));
    expect(file?.url.startsWith("/images/rooms/")).toBe(true);
  });

  /* Two owners uploading two different photographs called "portrait" must get
     two files, not one of them silently replacing the other. */
  it("separates two different pictures with the same name", async () => {
    const files = await prepareUploads(
      [
        { id: "a", name: "portrait.jpg", dataUrl: jpeg("QUJD") },
        { id: "b", name: "portrait.jpg", dataUrl: jpeg("WFla") }
      ],
      "public/images"
    );
    expect(files[0]?.path).not.toBe(files[1]?.path);
  });

  it("gives the same picture the same name twice", async () => {
    const first = await prepareUploads(one, "public/images");
    const again = await prepareUploads(one, "public/images");
    expect(first[0]?.path).toBe(again[0]?.path);
  });

  /* Persian and Arabic filenames slug away to nothing, and half the fleet's
     owners have them. */
  it("still names a file whose name is not Latin at all", async () => {
    const [file] = await prepareUploads([{ id: "u1", name: "پرتره.jpg", dataUrl: jpeg() }], "public/images");
    expect(file?.path).toMatch(/^public\/images\/image-[0-9a-f]{8}\.jpg$/);
  });

  it("takes nothing at all as nothing to do", async () => {
    expect(await prepareUploads(undefined, "public/images")).toEqual([]);
    expect(await prepareUploads([], "public/images")).toEqual([]);
  });

  /* The iOS trap, from the server's side: `canvas.toDataURL` falls back to PNG
     silently, so what arrives is not something to take the client's word for. */
  it("refuses anything that is not a JPEG data URL", async () => {
    for (const bad of [
      "data:image/png;base64,QUJD",
      "data:image/webp;base64,QUJD",
      "data:text/html;base64,QUJD",
      "https://example.com/a.jpg",
      "data:image/jpeg;base64,not base64!",
      ""
    ]) {
      await expect(prepareUploads([{ id: "u1", dataUrl: bad }], "public/images")).rejects.toBeInstanceOf(
        UploadError
      );
    }
  });

  it("refuses an id that could mean something else in an edit", async () => {
    for (const id of ["", "../etc", "a b", "u1/u2", "x".repeat(65)]) {
      await expect(prepareUploads([{ id, dataUrl: jpeg() }], "public/images")).rejects.toBeInstanceOf(
        UploadError
      );
    }
  });

  it("refuses the same id twice", async () => {
    await expect(
      prepareUploads([{ id: "u1", dataUrl: jpeg("QUJD") }, { id: "u1", dataUrl: jpeg("WFla") }], "public/images")
    ).rejects.toBeInstanceOf(UploadError);
  });

  it("refuses something that is not a list", async () => {
    await expect(prepareUploads({ id: "u1" }, "public/images")).rejects.toBeInstanceOf(UploadError);
  });

  it("holds the ceilings it is given", async () => {
    const big = jpeg("QUJD".repeat(1000));
    await expect(prepareUploads([{ id: "u1", dataUrl: big }], "public/images", { maxBytes: 100 })).rejects.toThrow(
      /too big/i
    );
    await expect(
      prepareUploads(
        [
          { id: "a", dataUrl: big },
          { id: "b", dataUrl: jpeg("WFla") }
        ],
        "public/images",
        { maxTotalBytes: 100 }
      )
    ).rejects.toBeInstanceOf(UploadError);
    await expect(
      prepareUploads([{ id: "a", dataUrl: jpeg() }, { id: "b", dataUrl: jpeg("WFla") }], "public/images", {
        maxFiles: 1
      })
    ).rejects.toBeInstanceOf(UploadError);
  });
});

describe("resolveUploads", () => {
  const files = [
    { id: "u1", path: "public/images/a-0011aabb.jpg", url: "/images/a-0011aabb.jpg", base64: "QUJD", bytes: 3 }
  ];

  it("swaps a placeholder for the path the file landed at", () => {
    expect(resolveUploads("upload:u1", files)).toBe("/images/a-0011aabb.jpg");
  });

  /* A new gallery row arrives as a whole array with the placeholder buried in
     it, because that is how a repeater sends a structural change. */
  it("finds one buried inside a whole array", () => {
    const rows = [{ src: "/images/old.jpg", alt: "before" }, { src: "upload:u1", alt: "new", w: 1600 }];
    expect(resolveUploads(rows, files)).toEqual([
      { src: "/images/old.jpg", alt: "before" },
      { src: "/images/a-0011aabb.jpg", alt: "new", w: 1600 }
    ]);
  });

  it("leaves ordinary text alone, including text that merely mentions one", () => {
    expect(resolveUploads("upload:u1 and more", files)).toBe("upload:u1 and more");
    expect(resolveUploads("A photograph", files)).toBe("A photograph");
    expect(resolveUploads(1600, files)).toBe(1600);
    expect(resolveUploads(null, files)).toBe(null);
  });

  /* Writing the literal text `upload:zz` into somebody's `src` would commit a
     broken image that looks exactly like content. */
  it("refuses a placeholder with no file behind it", () => {
    expect(() => resolveUploads("upload:zz", files)).toThrow(UploadError);
    expect(() => resolveUploads({ hero: { src: "upload:zz" } }, files)).toThrow(UploadError);
  });
});
