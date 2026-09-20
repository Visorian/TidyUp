import { changeStyle, restoreStyle, type StyleChange } from './style-change';

interface ScrollLock {
  readonly overlays: Set<Element>;
  readonly changes: readonly StyleChange[];
}

// Overlays usually lock page scrolling, so hiding one has to hand scrolling back.
export class ScrollLocks {
  private readonly locks = new Map<Document, ScrollLock>();

  unlock(element: HTMLElement): void {
    const document = element.ownerDocument;
    const existing = this.locks.get(document);
    if (existing !== undefined) {
      existing.overlays.add(element);
      return;
    }
    const changes: StyleChange[] = [];
    for (const root of [document.documentElement, document.body]) {
      if (root === null) continue;
      const style = document.defaultView?.getComputedStyle(root);
      if (style === undefined) continue;
      for (const property of ['overflow-x', 'overflow-y']) {
        if (['hidden', 'clip'].includes(style.getPropertyValue(property)))
          changes.push(changeStyle(root, property, 'auto'));
      }
      // A page frozen out of flow keeps the reading position in its own top edge.
      if (style.position !== 'fixed') continue;
      const offset = Number(style.top.replace('px', ''));
      changes.push(changeStyle(root, 'position', 'static'));
      if (offset < 0) document.defaultView?.scrollTo(0, -offset);
    }
    this.locks.set(document, { overlays: new Set([element]), changes });
  }

  restore(element: HTMLElement): void {
    const document = element.ownerDocument;
    const lock = this.locks.get(document);
    if (lock === undefined) return;
    lock.overlays.delete(element);
    if (lock.overlays.size > 0) return;
    for (const change of lock.changes) restoreStyle(change);
    this.locks.delete(document);
  }
}
