/* The app shell — what turns an admin surface into something you install.
   ---------------------------------------------------------------------------
   Two surfaces in this fleet are admin surfaces: the studio's fleet console at
   /admin, and every site owner's editor at /edit. They want the same four
   things — install to a home screen, unlock with a fingerprint, know which
   version you are looking at, and never show a control that does nothing — and
   until 0.23.0 exactly one of them had any of it, in a repo no site can
   import.

   This is the shared half, and the boundary it draws is that **nothing here
   holds a user-facing string**. The console speaks English and the editor
   speaks three languages; a shared module that owned its own wording would
   have forced the editor to translate around it, which is the bug session 17
   spent itself undoing. Everything here returns a code or a state, and each
   surface says it in the language it is already speaking.

   The other half of the boundary: nothing here draws anything. There is no
   markup and no CSS in this directory. The console renders these states as
   footer buttons in its own idiom and the editor renders them as rows in a
   sheet in its own, and neither had to be persuaded to look like the other.

   Everything here runs **in a browser page** and is built by
   tsconfig.editor.json with DOM types. The two generators that make an app
   installable — the manifest and the service worker source — deliberately do
   not live here: they run inside a site's Astro build, in Node, where DOM
   types are absent on purpose, so they sit in `../astro/` with the rest of the
   build-time code. Putting them here would have pulled `navigator` into a
   config that exists to prove nothing reaches for it. */

export {
  createPasskey,
  type Passkey,
  type PasskeyOptions,
  type PasskeyReason,
  type PasskeyResult
} from "./passkey.js";

export { createLadder, type Ladder, type Rung } from "./unlock.js";

export { createPwa, type Pwa, type PwaOptions } from "./pwa.js";
