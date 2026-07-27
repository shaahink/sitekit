export function squash(text: unknown, max: number): string {
  const out = String(text || "").replace(/\s+/g, " ").trim();
  return out.length > max ? out.slice(0, max - 1) + "…" : out;
}

export function basename(url: unknown): string {
  const parts = String(url || "").split("/");
  return (parts[parts.length - 1] || "").split("?")[0] || "";
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
