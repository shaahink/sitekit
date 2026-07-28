import type { z } from "zod";

/* The editor deliberately reuses the sk-feedback App (session 7, Decision 3).
   It already holds Contents: read/write on every repo in the fleet, and its
   installation already covers `site` and `site-template`, so a new site
   inherits the credential with no registration at all. A second App would mean
   a second key, three more variables per site, and a second thing to rotate.

   The cost is cosmetic: content commits are authored by `sk-feedback[bot]`,
   which reads oddly next to "Bruce edited home.yaml". CMS.md says so on every
   site, so it never looks like a mistake. */
export interface CmsEnv {
  /** The Google OAuth client ID tokens must be addressed to. */
  googleClientId?: string | undefined;
  /** Comma-separated Google emails and/or `sub` ids allowed to edit. */
  allowlist?: string | undefined;
  /** HMAC key for the session cookie. Rotating it signs everyone out. */
  sessionSecret?: string | undefined;

  /* The App trio, already on every deployment for feedback. */
  appId?: string | undefined;
  appPrivateKey?: string | undefined;
  appInstallationId?: string | undefined;
  /** PAT fallback, mirroring feedback's shape. Nothing in the fleet uses it. */
  token?: string | undefined;

  repo?: string | undefined;
  /** Defaults to the repo's default branch. */
  branch?: string | undefined;
  allowedOrigin?: string | undefined;
}

export interface CollectionConfig {
  schema: z.ZodType;
  /** A single-entry collection — the one file behind it. */
  file?: string;
  /** A multi-entry collection — the directory of one file per entry. */
  dir?: string;
  /** Field paths the owner shouldn't edit: image `w`/`h`, mostly, which the
      layouts depend on. Templates use the form model's `[]` spelling. */
  omit?: string[];
  /** Shown in the panel instead of the collection key. */
  label?: string;
  /** Shown in the panel instead of an entry's file name, keyed by it.
      A bilingual site needs this: `home.fr` only reads as "the French page"
      to someone who already knows, and the one mistake the editor must not
      make easy is editing the wrong locale believing it is the right one. */
  entryLabels?: Record<string, string>;
}

export interface ContentHandlerOptions {
  collections: Record<string, CollectionConfig>;
  env: CmsEnv | (() => CmsEnv);
  userAgent?: string;
  /** How long a sign-in lasts, in seconds. An hour by default. */
  sessionMaxAge?: number;
}
