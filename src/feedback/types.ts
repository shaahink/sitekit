/* Configuration for the feedback intake handler.
   ---------------------------------------------------------------------------
   Everything a site used to hardcode is an option here. The kit never reads
   process.env — the host's thin wrapper reads its environment at the edge and
   passes values in, which is what keeps the Cloudflare adapter a one-line
   swap (PLAN §3.4). */

/** Values read from the host's environment and passed in per request. */
export interface FeedbackEnv {
  /** Fine-grained PAT with Issues RW and Contents RW on the site repo. */
  token?: string | undefined;
  /** The repo issues are filed against, as "owner/name". */
  repo?: string | undefined;
  /** The secret carried by the ?review=... link. */
  reviewKey?: string | undefined;
  /** Orphan branch that stores screenshots. Defaults to "feedback-assets". */
  branch?: string | undefined;
  /** Canonical site origin for links back; defaults to https://<host>. */
  siteUrl?: string | undefined;
  /** An extra origin allowed to post, beyond the request's own host. */
  allowedOrigin?: string | undefined;
}

/** How a page language maps to a human name and an issue label. */
export interface LocaleRule {
  /** Matched against the page's lowercased `lang`, by prefix. */
  prefix: string;
  /** Human name shown in the details table, e.g. "French". */
  name: string;
  /** Issue label to add when this locale matches, e.g. "fr". Optional. */
  label?: string | undefined;
}

export interface RateLimit {
  max: number;
  windowMs: number;
}

export interface FeedbackOptions {
  /** Environment values, or a function returning them per request. */
  env: FeedbackEnv | (() => FeedbackEnv);
  /** Language mapping for the details table and issue labels. Default: none —
      unknown languages show their code and add no label. */
  locales?: LocaleRule[];
  /** IANA zone for the timestamp under each note. Default "UTC". */
  timeZone?: string;
  /** BCP 47 locale for formatting that timestamp. Default "en-GB". */
  timestampLocale?: string;
  /** User-Agent sent to the GitHub API. Default "review-mode-feedback". */
  userAgent?: string;
  /** Labels every note gets. Default ["feedback"]. */
  labels?: string[];
  /** Label added when a screenshot is attached. Default "screenshot". */
  screenshotLabel?: string;
  /** Longest accepted comment, in characters. Default 5000. */
  maxComment?: number;
  /** Largest accepted request body, in bytes. Default 3_000_000. */
  maxBodyBytes?: number;
  /** Largest accepted screenshot, in base64 characters. Default 2_200_000. */
  maxImageBase64?: number;
  /** Warm-instance throttle. Default 15 notes per IP per 10 minutes. */
  rateLimit?: RateLimit;
}
