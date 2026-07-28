/* Who may edit a site.
   ---------------------------------------------------------------------------
   Session 7, Decision 4: match on either the Google `sub` or the email, and
   document which is which. `sub` is Google's stable identifier and survives an
   email change; the email is the thing Shahin actually knows when a client
   says "use my gmail". Requiring one form or the other would mean either
   asking clients for an opaque number or breaking when someone changes their
   address, so both are accepted — one comma-separated variable per site.

   Emails compare case-insensitively; `sub` values are opaque and compare
   exactly. An unset or empty allowlist admits nobody: a site that is
   half-configured must not be an open door. */

export function allows(
  list: string | undefined,
  identity: { sub: string; email: string }
): boolean {
  if (!list) return false;
  const email = identity.email.trim().toLowerCase();
  for (const raw of list.split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    if (entry === identity.sub) return true;
    if (entry.toLowerCase() === email) return true;
  }
  return false;
}
