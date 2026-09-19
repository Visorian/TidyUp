import { presentationFingerprint } from '../candidates/fingerprint';
import { extractSpecialCandidate, specialPresentationFingerprint } from '../candidates/regions';
import { isSafeCandidateBoundary } from '../candidates/visibility';
import type { AdCandidate } from '../shared/types';
import { findAdContainer, isAdContainer } from './ad-container';
import { adBackgroundColorTarget, adBackgroundVariables } from './background-color';

interface StyleChange {
  readonly element: HTMLElement;
  readonly property: string;
  readonly value: string;
  readonly priority: string;
  readonly applied: string;
  readonly appliedPriority: string;
}

interface Presentation {
  readonly element: HTMLElement;
  readonly target: HTMLElement;
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
  return {
    ...change,
    applied: element.style.getPropertyValue(property),
    appliedPriority: element.style.getPropertyPriority(property),
  };
}

function restoreStyle(change: StyleChange): void {
  const { element, property, applied, value, priority } = change;
  if (
    element.style.getPropertyValue(property) !== applied ||
    element.style.getPropertyPriority(property) !== change.appliedPriority
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

  target(element: Element): Element {
    return this.entries.get(element)?.target ?? element;
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
    const target = !debug && kind === undefined ? findAdContainer(element) : element;
    const property = debug ? 'outline' : kind === 'background' ? 'background-image' : 'display';
    const color = probability >= threshold ? '#dc2626' : probability <= 0.1 ? '#16a34a' : '#ca8a04';
    const background = debug ? null : adBackgroundColorTarget(element, target, kind);
    const variables = debug ? [] : adBackgroundVariables(element, target);
    const changes = [changeStyle(target, property, debug ? `3px solid ${color}` : 'none')];
    if (background !== null) changes.push(changeStyle(background, 'background-color', ''));
    for (const variable of variables)
      changes.push(changeStyle(element.ownerDocument.body, variable, 'inherit'));
    this.entries.set(element, {
      element,
      target,
      kind,
      debug,
      fingerprint: currentFingerprint,
      changes,
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
    for (const [element, entry] of this.entries) {
      const affected = targets.some(
        (target) =>
          target === element.ownerDocument ||
          entry.target.contains(target) ||
          target.contains(entry.target),
      );
      if (!element.isConnected || !entry.target.isConnected || affected) this.pending.add(element);
    }
  }

  restoreNext():
    | { readonly restored: boolean; readonly root: Element | null; readonly element: Element }
    | undefined {
    const element = this.pending.values().next().value;
    if (element === undefined) return undefined;
    this.pending.delete(element);
    const entry = this.entries.get(element);
    if (entry === undefined) return { restored: false, root: null, element };
    if (
      element.isConnected &&
      (entry.kind !== undefined || safePresentation(element)) &&
      (entry.target === element || isAdContainer(entry.target, entry.element)) &&
      fingerprint(element, entry.kind) === entry.fingerprint &&
      entry.changes.every(
        (change) =>
          change.element.style.getPropertyValue(change.property) === change.applied &&
          change.element.style.getPropertyPriority(change.property) === change.appliedPriority,
      )
    ) {
      if (!entry.debug) {
        const variables = adBackgroundVariables(entry.element, entry.target).filter(
          (variable) =>
            !entry.changes.some(
              (change) =>
                change.element === element.ownerDocument.body && change.property === variable,
            ),
        );
        if (variables.length > 0)
          this.entries.set(element, {
            ...entry,
            changes: [
              ...entry.changes,
              ...variables.map((variable) =>
                changeStyle(element.ownerDocument.body, variable, 'inherit'),
              ),
            ],
          });
      }
      return { restored: false, root: null, element };
    }
    const root = entry.target.isConnected ? entry.target : element.isConnected ? element : null;
    return {
      element,
      restored: this.restore(element),
      root,
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
      'srcdoc',
      'width',
      'height',
      'tabindex',
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
