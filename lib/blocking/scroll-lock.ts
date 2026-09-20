import { changeStyle, restoreStyle, type StyleChange } from './style-change';

interface ScrollLock {
  readonly overlays: Set<Element>;
  readonly changes: readonly StyleChange[];
}

// Overlays usually lock page scrolling, so hiding one has to hand scrolling back.
export class ScrollLocks {
  private readonly locks = new Map<Document, ScrollLock>();

  // A page can be frozen after its overlay was hidden, so every revisit releases what is locked
  // now and keeps the earlier changes for restoration.
  unlock(element: HTMLElement): void {
    const document = element.ownerDocument;
    const existing = this.locks.get(document);
    const changes = release(document);
    const overlays = existing?.overlays ?? new Set<Element>();
    overlays.add(element);
    this.locks.set(document, {
      overlays,
      changes: existing === undefined ? changes : [...existing.changes, ...changes],
    });
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

function release(document: Document): StyleChange[] {
  const changes: StyleChange[] = [];
  for (const root of [document.documentElement, document.body]) {
    if (root === null) continue;
    const style = document.defaultView?.getComputedStyle(root);
    if (style === undefined) continue;
    // Only the axis a page reads along is handed back; clipping sideways is ordinary layout.
    if (['hidden', 'clip'].includes(style.getPropertyValue('overflow-y')))
      changes.push(changeStyle(root, 'overflow-y', 'auto'));
    // A page frozen out of flow keeps the reading position in its own top edge.
    if (style.position !== 'fixed') continue;
    const offset = Number(style.top.replace('px', ''));
    changes.push(changeStyle(root, 'position', 'static'));
    if (offset < 0) document.defaultView?.scrollTo(0, -offset);
  }
  return changes;
}
