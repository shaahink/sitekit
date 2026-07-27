/* The dual header emitter.
   ---------------------------------------------------------------------------
   One definition of a site's headers, emitted as both vercel.json and
   Cloudflare _headers/_redirects, so no host-specific file is ever
   hand-maintained and the host stays a choice (PLAN §3.4).

   Paths are written in the neutral (Cloudflare-shaped) form: "/*" matches
   everything, "/api/*" a prefix, "/favicon.svg" exactly. The Vercel emitter
   translates them to its regex form. */

export interface HeaderRule {
  /** "/*", "/api/*", or an exact path. */
  path: string;
  /** Header name → value, emitted in insertion order. */
  headers: Record<string, string>;
}

export interface RedirectRule {
  from: string;
  to: string;
  /** HTTP status. Default 302. */
  status?: number;
}

export interface HostConfig {
  headers: HeaderRule[];
  /** Branches whose pushes must never deploy — the screenshot branch. This is
      a Vercel-file concern; Cloudflare Pages configures it in the dashboard. */
  disableDeploymentsFor?: string[];
  redirects?: RedirectRule[];
  /** Extra top-level vercel.json keys — framework, outputDirectory — merged in
      directly after $schema. A Vercel-file concern with no Cloudflare
      counterpart; the Cloudflare emitters never see it. */
  vercel?: Record<string, unknown>;
}

/** The complete vercel.json text, trailing newline included — meant to be
    written to disk verbatim and committed. */
export function vercelJson(config: HostConfig): string {
  const out: Record<string, unknown> = {
    "$schema": "https://openapi.vercel.sh/vercel.json",
    ...config.vercel
  };

  if (config.disableDeploymentsFor && config.disableDeploymentsFor.length) {
    const branches: Record<string, boolean> = {};
    for (const branch of config.disableDeploymentsFor) branches[branch] = false;
    out["git"] = { deploymentEnabled: branches };
  }

  out["headers"] = config.headers.map((rule) => ({
    source: vercelSource(rule.path),
    headers: Object.entries(rule.headers).map(([key, value]) => ({ key, value }))
  }));

  if (config.redirects && config.redirects.length) {
    out["redirects"] = config.redirects.map((rule) => ({
      source: vercelSource(rule.from),
      destination: rule.to,
      permanent: rule.status === 301 || rule.status === 308
    }));
  }

  /* House format: standard two-space JSON, except each header pair sits on
     one line — the shape session 1 wrote by hand, which this emitter has to
     reproduce byte-for-byte before it may replace those files. */
  const text = JSON.stringify(out, null, 2).replace(
    /\{\n\s+"key": (".*"),\n\s+"value": (".*")\n\s+\}/g,
    '{ "key": $1, "value": $2 }'
  );
  return text + "\n";
}

/** The complete Cloudflare _headers text. */
export function cloudflareHeaders(config: HostConfig): string {
  return config.headers
    .map((rule) =>
      [rule.path, ...Object.entries(rule.headers).map(([key, value]) => `  ${key}: ${value}`)].join("\n")
    )
    .join("\n\n") + "\n";
}

/** The complete Cloudflare _redirects text. */
export function cloudflareRedirects(config: HostConfig): string {
  const rules = config.redirects || [];
  return rules.map((rule) => `${rule.from} ${rule.to} ${rule.status ?? 302}`).join("\n") + "\n";
}

/* "/api/*" → "/api/(.*)", "/*" → "/(.*)", exact paths pass through. */
function vercelSource(path: string): string {
  if (path.endsWith("/*")) return path.slice(0, -2) + "/(.*)";
  return path;
}
