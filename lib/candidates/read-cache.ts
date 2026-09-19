type BooleanRead = 'private' | 'hidden' | 'overlay' | 'consent-ancestor';

export class CandidateReadCache {
  private styles = new WeakMap<Element, Map<string, CSSStyleDeclaration | undefined>>();
  private flags = new WeakMap<Element, Map<BooleanRead, boolean>>();
  private labels = new WeakMap<Element, string>();

  clear(): void {
    this.styles = new WeakMap();
    this.flags = new WeakMap();
    this.labels = new WeakMap();
  }

  style(element: Element, pseudo: string): CSSStyleDeclaration | undefined {
    let styles = this.styles.get(element);
    if (styles === undefined) {
      styles = new Map();
      this.styles.set(element, styles);
    }
    if (!styles.has(pseudo)) styles.set(pseudo, freshStyle(element, pseudo));
    return styles.get(pseudo);
  }

  flag(element: Element, key: BooleanRead, read: () => boolean): boolean {
    let flags = this.flags.get(element);
    if (flags === undefined) {
      flags = new Map();
      this.flags.set(element, flags);
    }
    const value = flags.get(key);
    if (value !== undefined) return value;
    const result = read();
    flags.set(key, result);
    return result;
  }

  label(element: Element, read: () => string): string {
    const value = this.labels.get(element);
    if (value !== undefined) return value;
    const result = read();
    this.labels.set(element, result);
    return result;
  }
}

let current: Readonly<CandidateReadCache> | undefined;

// Reads are shared only within synchronous extraction; presentation and async validation stay fresh.
export function withCandidateReads<T>(cache: Readonly<CandidateReadCache>, read: () => T): T {
  const previous = current;
  current = cache;
  try {
    return read();
  } finally {
    current = previous;
  }
}

function freshStyle(element: Element, pseudo: string): CSSStyleDeclaration | undefined {
  return element.ownerDocument.defaultView?.getComputedStyle(element, pseudo || null);
}

export function computedStyle(element: Element, pseudo = ''): CSSStyleDeclaration | undefined {
  return current === undefined ? freshStyle(element, pseudo) : current.style(element, pseudo);
}

export function cachedBoolean(element: Element, key: BooleanRead, read: () => boolean): boolean {
  return current === undefined ? read() : current.flag(element, key, read);
}

export function cachedAdLabel(element: Element, read: () => string): string {
  return current === undefined ? read() : current.label(element, read);
}
