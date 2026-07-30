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

/** Open every disclosure above a node, so something the panel needs an owner
    to see is not behind a summary they never tapped.

    Three callers, all of them one of §2.4's auto-open rules: a field that is
    holding Save, a field a rejected save complained about, and a field an
    incoming link named. Written from the node outwards rather than from the top
    level down, so a nested collapse later inherits it for free.

    `tagName` rather than `instanceof HTMLDetailsElement`: this file is the one
    the tests can reach, and a DOM standing in for a browser's is not obliged to
    export the same constructors. */
export function reveal(node: HTMLElement): void {
  for (let up = node.parentElement; up; up = up.parentElement) {
    if (up.tagName === "DETAILS") (up as HTMLDetailsElement).open = true;
  }
}

/** Put text on the clipboard, and where the browser refuses, put it in front of
    the owner instead.

    Lifted from `widget/chrome.ts`'s `offerCopy`, which has been the fleet's
    answer to "never swallow what was written" since the review widget shipped:
    `navigator.clipboard` is absent without a secure context and can be refused
    outright, and a `window.prompt` holding the text is still an owner who can
    select it. Both surfaces of the editor call this from the conflict note
    (§2.6, F7), so both offer the same thing in the same order.

    Resolves only when the text really is on the clipboard, because the button's
    "Copied" is bound to that promise and a label claiming something that did not
    happen is worse than no label. */
export async function copyText(text: string, promptLabel: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    window.prompt(promptLabel, text);
    throw new Error("clipboard refused");
  }
}

/** CSS.escape where it exists, and enough of it where it doesn't: the only
    place this is used builds an attribute selector, so quotes and backslashes
    are the whole risk. */
export function cssEscape(value: string): string {
  const api = (window as { CSS?: { escape?: (v: string) => string } }).CSS;
  return api?.escape ? api.escape(value) : value.replace(/["\\]/g, "\\$&");
}
