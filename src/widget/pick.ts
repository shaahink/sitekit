export interface RefineOptions {
  /** Elements the picker must ignore — typically anything inside the
      widget's own chrome. */
  exclude?: (element: Element) => boolean;
}

/* Walk up from slivers of inline text to something with a real box — tapping
   a single <em> inside a paragraph should still highlight the paragraph. */
export function refine(node: EventTarget | Node | null, options: RefineOptions = {}): Element | null {
  const exclude = options.exclude;
  if (!node || (node as Node).nodeType !== 1) return null;
  let current = node as Element;
  if (exclude && exclude(current)) return null;
  if (current === document.body || current === document.documentElement) return null;

  for (let i = 0; i < 4; i++) {
    const rect = current.getBoundingClientRect();
    if (rect.width * rect.height >= 600 && rect.width >= 24) break;
    const parent = current.parentElement;
    if (!parent || parent === document.body) break;
    current = parent;
  }
  return current;
}

/* Shortest useful CSS path: stop as soon as we hit an id. */
export function selectorFor(node: Element | null): string {
  const path: string[] = [];
  let current: Element | null = node;
  while (current && current.nodeType === 1 && current !== document.body && path.length < 6) {
    if (current.id) {
      path.unshift("#" + current.id);
      break;
    }
    let name = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (parent) {
      const el: Element = current;
      const siblings = Array.prototype.filter.call(parent.children, function (child: Element) {
        return child.tagName === el.tagName;
      }) as Element[];
      if (siblings.length > 1) name += ":nth-of-type(" + (siblings.indexOf(el) + 1) + ")";
    }
    path.unshift(name);
    current = parent;
  }
  return path.join(" > ");
}
