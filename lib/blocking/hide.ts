import { presentationFingerprint } from '../candidates/fingerprint';
import { extractSpecialCandidate, specialPresentationFingerprint } from '../candidates/regions';
import { isSafeCandidateBoundary } from '../candidates/visibility';
import type { AdCandidate } from '../shared/types';

interface StyleChange {
  readonly element: HTMLElement;
  readonly property: string;
  readonly value: string;
  readonly priority: string;
  readonly applied: string;
}

interface Presentation {
  readonly element: HTMLElement;
  readonly kind: AdCandidate['kind'];
  readonly debug: boolean;
  readonly changes: readonly StyleChange[];
  readonly fingerprint: string;
}

interface ScrollLock {
  readonly overlays: Set<Element>;
  readonly changes: readonly StyleChange[];
}

function changeStyle(element: HTMLElement, property: string, applied: string): StyleChange {
  const change = {
    element,
    property,
    value: element.style.getPropertyValue(property),
    priority: element.style.getPropertyPriority(property),
  };
  element.style.setProperty(property, applied, 'important');
  return { ...change, applied: element.style.getPropertyValue(property) };
}

function restoreStyle(change: StyleChange): void {
  const { element, property, applied, value, priority } = change;
  if (
    element.style.getPropertyValue(property) !== applied ||
    element.style.getPropertyPriority(property) !== 'important'
  )
    return;
  if (value === '') element.style.removeProperty(property);
  else element.style.setProperty(property, value, priority);
}

function fingerprint(element: Element, kind: AdCandidate['kind']): string | null {
  return kind === undefined
    ? presentationFingerprint(element)
    : specialPresentationFingerprint(element, kind);
}

const ESSENTIAL =
  'main,nav,form,input,textarea,select,[contenteditable],[role="main"],[role="navigation"],[role="dialog"],[role="textbox"]';

function safePresentation(element: Element): boolean {
  return (
    isSafeCandidateBoundary(element) &&
    !element.matches(`header,footer,${ESSENTIAL}`) &&
    element.querySelector(ESSENTIAL) === null
  );
}

export class PresentationStore {
  private readonly entries = new Map<Element, Presentation>();
  private readonly pending = new Set<Element>();
  private readonly scrollLocks = new Map<Document, ScrollLock>();

  get hasPending(): boolean {
    return this.pending.size > 0;
  }

  has(element: Element): boolean {
    return this.entries.has(element);
  }

  apply(
    element: Element,
    probability: number,
    threshold: number,
    debug: boolean,
    kind?: AdCandidate['kind'],
  ): boolean {
    if (
      !(element instanceof HTMLElement) ||
      this.entries.has(element) ||
      this.entries.size >= 512 ||
      (kind === undefined
        ? !safePresentation(element)
        : extractSpecialCandidate(element, 'presentation', element.ownerDocument.location.hostname)
            ?.kind !== kind)
    )
      return false;
    if (!debug && probability < threshold) return false;
    const currentFingerprint = fingerprint(element, kind);
    if (currentFingerprint === null) return false;
    const property = debug ? 'outline' : kind === 'background' ? 'background-image' : 'display';
    const color = probability >= threshold ? '#dc2626' : probability <= 0.1 ? '#16a34a' : '#ca8a04';
    this.entries.set(element, {
      element,
      kind,
      debug,
      fingerprint: currentFingerprint,
      changes: [changeStyle(element, property, debug ? `3px solid ${color}` : 'none')],
    });
    if (kind === 'consent' && !debug) this.unlockScrolling(element);
    return !debug;
  }

  private unlockScrolling(element: HTMLElement): void {
    const document = element.ownerDocument;
    const existing = this.scrollLocks.get(document);
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
    }
    this.scrollLocks.set(document, { overlays: new Set([element]), changes });
  }

  private restoreScrolling(element: HTMLElement): void {
    const document = element.ownerDocument;
    const lock = this.scrollLocks.get(document);
    if (lock === undefined) return;
    lock.overlays.delete(element);
    if (lock.overlays.size > 0) return;
    for (const change of lock.changes) restoreStyle(change);
    this.scrollLocks.delete(document);
  }

  restore(element: Element): boolean {
    this.pending.delete(element);
    const entry = this.entries.get(element);
    if (entry === undefined) return false;
    for (const change of entry.changes) restoreStyle(change);
    if (entry.kind === 'consent' && !entry.debug) this.restoreScrolling(entry.element);
    this.entries.delete(element);
    return !entry.debug;
  }

  restoreAll(): number {
    let restored = 0;
    for (const element of this.entries.keys()) {
      if (this.restore(element)) restored++;
    }
    return restored;
  }

  queueChanges(targets: readonly Node[]): void {
    for (const element of this.entries.keys()) {
      const affected = targets.some(
        (target) =>
          target === element.ownerDocument || element.contains(target) || target.contains(element),
      );
      if (!element.isConnected || affected) this.pending.add(element);
    }
  }

  restoreNext():
    | { readonly restored: boolean; readonly root: Element | null; readonly element: Element }
    | undefined {
    const element = this.pending.values().next().value;
    if (element === undefined) return undefined;
    this.pending.delete(element);
    const entry = this.entries.get(element);
    if (
      entry === undefined ||
      (element.isConnected &&
        (entry.kind !== undefined || safePresentation(element)) &&
        fingerprint(element, entry.kind) === entry.fingerprint &&
        entry.changes.every(
          (change) =>
            change.element.style.getPropertyValue(change.property) === change.applied &&
            change.element.style.getPropertyPriority(change.property) === 'important',
        ))
    )
      return { restored: false, root: null, element };
    return {
      element,
      restored: this.restore(element),
      root: element.isConnected ? element : null,
    };
  }
}

export function watchPresentation(
  observer: Pick<MutationObserver, 'observe'>,
  element: Element,
): void {
  observer.observe(element, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      'href',
      'src',
      'class',
      'id',
      'title',
      'aria-label',
      'role',
      'contenteditable',
      'hidden',
      'style',
    ],
  });
}
