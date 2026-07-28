/* The three DOM helpers the panel is built out of, plus the textarea trick.
   Small on purpose: everything above this file reads as structure, not as
   createElement noise. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A label wrapping its own control — used for the collection picker, where
    the control is the label's only child and needs no id. */
export function labelled(text: string, control: HTMLElement): HTMLLabelElement {
  const wrap = el("label", "sk-editor__field");
  wrap.append(el("span", "sk-editor__label", text), control);
  return wrap;
}

export function link(href: string, text: string): HTMLAnchorElement {
  const node = el("a", "sk-editor__link", text);
  node.href = href;
  node.target = "_blank";
  node.rel = "noopener";
  return node;
}

/* Collapse before measuring. A textarea's `auto` height resolves to its `rows`
   attribute, not to its content, so measuring after `auto` can only ever grow
   the box — set it to zero first and scrollHeight tells the truth. The +2 is
   the top and bottom border, which scrollHeight leaves out. */
export function grow(area: HTMLTextAreaElement): void {
  area.style.blockSize = "0";
  area.style.blockSize = `${area.scrollHeight + 2}px`;
}

/** CSS.escape where it exists, and enough of it where it doesn't: the only
    place this is used builds an attribute selector, so quotes and backslashes
    are the whole risk. */
export function cssEscape(value: string): string {
  const api = (window as { CSS?: { escape?: (v: string) => string } }).CSS;
  return api?.escape ? api.escape(value) : value.replace(/["\\]/g, "\\$&");
}
