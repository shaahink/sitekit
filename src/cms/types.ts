import type { z } from "zod";
import type { UploadLimits } from "./uploads.js";

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

  /* Session 22 — the fleet signs people in on one origin.

     `authOrigin` is a **site's** whole share of it: the URL of the origin that
     is registered with Google, identical on every site in the fleet, and not a
     secret. Set it and the editor prefers the hand-off; leave it unset and
     nothing changes. `CMS_AUTH_ORIGIN`.

     The other two belong to the auth origin alone and mean nothing on a site.
     `ticketPrivateKey` is the one new secret this design adds anywhere —
     PKCS#8 PEM, `CMS_TICKET_PRIVATE_KEY`. `fleetOrigins` is the list of
     origins it will sign a ticket for, which is what stops it being an open
     redirector that signs what it hands over; `CMS_FLEET_ORIGINS`. */
  authOrigin?: string | undefined;
  ticketPrivateKey?: string | undefined;
  fleetOrigins?: string | undefined;

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

  /* The owner's own traffic, for the home panel (7.7). Three variables and not
     four: the fleet dashboard needs a team to enumerate through, and this
     reads one website by id, which the instance serves without one. All three
     absent is a supported state — the panel simply has no traffic block, which
     is the whole of "degrade quietly". */
  umamiUrl?: string | undefined;
  umamiUsername?: string | undefined;
  umamiPassword?: string | undefined;
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
  /** Where each entry can be seen on the site, so the panel can offer to go
      and edit it in place — which is the only way an owner on a phone ever
      reaches inline editing without typing `?edit=1` into a URL bar.

      A string is a pattern with `{entry}` substituted
      (`"/projects/{entry}.html"`); an object maps entry ids to paths
      (`{ "home.fr": "/fr/" }`). Site-relative paths only; anything else is
      dropped. */
  entryUrl?: string | Record<string, string>;
  /** Where photographs added through the editor are committed, relative to the
      repository root. Defaults to `public/images/uploads`.

      It must sit under the site's public directory: the URL written into the
      content is this path with its **first segment removed**, which is Astro's
      rule for `public/`. A site that keeps images somewhere else — behind
      `astro:assets`, or as pre-built responsive variants — should leave image
      fields omitted rather than point this at them, because the editor writes
      one JPEG and one `src`, and neither of those shapes is that. */
  imageDir?: string;
}

export interface ContentHandlerOptions {
  collections: Record<string, CollectionConfig>;
  env: CmsEnv | (() => CmsEnv);
  userAgent?: string;
  /** This site's id in the analytics instance.

      Not an environment variable, deliberately: it is already public — the
      page's own tracker tag carries it — and an id that is in the markup but
      also in a deployment's configuration is two copies of one fact. It goes
      beside the layout that emits it, and both read the same constant. Only
      the login is a secret, and that is in `env`.

      Without it there is no traffic block; nothing else changes. */
  umamiWebsiteId?: string;
  /** Where "request a change" files its issue, if not this repo. Left alone,
      it is the same repository the content lives in, which is where the
      review widget already files. */
  requestLabel?: string;
  /** How long a sign-in lasts, in seconds. An hour by default. */
  sessionMaxAge?: number;
  /** Ceilings on what one save may carry in photographs. The defaults are in
      uploads.ts and are sized for a phone on a train rather than for GitHub's
      limits, which are far higher. */
  uploadLimits?: UploadLimits;
}
