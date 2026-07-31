/* This release's number, where code can read it.
   ---------------------------------------------------------------------------
   Two surfaces show it now — the editor's account sheet and the fleet console's
   footer — and the reason both do is the same: when an owner says "the save
   button did nothing", the first useful question is which version they were
   looking at, and a fleet where six sites can be pinned to three different
   releases cannot answer it from a document.

   It is a hand-written constant rather than a build-time import, and that is a
   deliberate trade. Importing `package.json` would be self-maintaining and
   would also mean a JSON import attribute in every build target that consumes
   this — Node, the Astro compiler, the browser bundle, the Worker — which is
   four things that can each disagree about a syntax that is still settling.

   The rot that a constant invites is closed by a test rather than by care:
   `version.test.ts` asserts this equals `package.json`'s `version`, so a
   release that forgets to change it fails before it is tagged. That is the
   same shape as the lesson `fleet-migrate.test.mjs` cost — assert against what
   the source of truth actually says, never against a second hand-written
   string standing in for it. */
export const KIT_VERSION = "0.23.0";
