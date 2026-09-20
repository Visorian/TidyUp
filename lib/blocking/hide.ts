import { presentationFingerprint } from '../candidates/fingerprint';
import { extractSpecialCandidate, specialPresentationFingerprint } from '../candidates/regions';
import { isSafeCandidateBoundary } from '../candidates/visibility';
import type { AdCandidate } from '../shared/types';
import { findAdContainer, isAdContainer } from './ad-container';
import { adSlotFingerprint } from './ad-slot';
import { adBackgroundColorTarget, adBackgroundVariables } from './background-color';
import { ScrollLocks } from './scroll-lock';
import { changeStyle, restoreStyle, type StyleChange } from './style-change';

interface Presentation {
  readonly element: HTMLElement;
  readonly target: HTMLElement;
  readonly kind: AdCandidate['kind'];
  readonly debug: boolean;
  readonly changes: readonly StyleChange[];
  readonly fingerprint: string;
}

function fingerprint(element: Element, kind: AdCandidate['kind']): string | null {
  if (kind === 'ad-slot') return adSlotFingerprint(element);
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
  private readonly scrollLocks = new ScrollLocks();

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
        : kind === 'ad-slot'
          ? adSlotFingerprint(element) === null
          : extractSpecialCandidate(
              element,
              'presentation',
              element.ownerDocument.location.hostname,
            )?.kind !== kind)
    )
      return false;
    if (!debug && probability < threshold) return false;
    // A slot keeps its identity while its creative loads, so the hide survives the late markup.
    const identity = kind ?? (adSlotFingerprint(element) === null ? undefined : 'ad-slot');
    const currentFingerprint = fingerprint(element, identity);
    if (currentFingerprint === null) return false;
    const target =
      !debug && (identity === undefined || identity === 'ad-slot')
        ? findAdContainer(element)
        : element;
    const property = debug ? 'outline' : identity === 'background' ? 'background-image' : 'display';
    const color = probability >= threshold ? '#dc2626' : probability <= 0.1 ? '#16a34a' : '#ca8a04';
    const background = debug ? null : adBackgroundColorTarget(element, target, identity);
    const variables = debug ? [] : adBackgroundVariables(element, target);
    const changes = [changeStyle(target, property, debug ? `3px solid ${color}` : 'none')];
    if (background !== null) changes.push(changeStyle(background, 'background-color', ''));
    for (const variable of variables)
      changes.push(changeStyle(element.ownerDocument.body, variable, 'inherit'));
    this.entries.set(element, {
      element,
      target,
      kind: identity,
      debug,
      fingerprint: currentFingerprint,
      changes,
    });
    if (identity === 'overlay' && !debug) this.scrollLocks.unlock(element);
    return !debug;
  }

  restore(element: Element): boolean {
    this.pending.delete(element);
    const entry = this.entries.get(element);
    if (entry === undefined) return false;
    for (const change of entry.changes) restoreStyle(change);
    if (entry.kind === 'overlay' && !entry.debug) this.scrollLocks.restore(entry.element);
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

  private updateBackground(entry: Presentation, background: HTMLElement | null): void {
    if (!entry.debug) {
      const variables = adBackgroundVariables(entry.element, entry.target).filter(
        (variable) =>
          !entry.changes.some(
            (change) =>
              change.element === entry.element.ownerDocument.body && change.property === variable,
          ),
      );
      if (variables.length > 0 || background !== null)
        this.entries.set(entry.element, {
          ...entry,
          changes: [
            ...entry.changes.filter(
              (change) => change.element !== background || change.property !== 'background-color',
            ),
            ...(background === null ? [] : [changeStyle(background, 'background-color', '')]),
            ...variables.map((variable) =>
              changeStyle(entry.element.ownerDocument.body, variable, 'inherit'),
            ),
          ],
        });
    }
  }

  // A placement can finish after it was hidden, only then revealing the wrapper that reserves its
  // space. Moving the hide up collapses that space without waiting for a second decision.
  private retarget(entry: Readonly<Presentation>): Presentation | null {
    if (entry.debug || (entry.kind !== undefined && entry.kind !== 'ad-slot')) return null;
    const target = findAdContainer(entry.element);
    if (target === entry.target || !target.contains(entry.target)) return null;
    const previous = entry.changes.find(
      (change) => change.element === entry.target && change.property === 'display',
    );
    if (previous === undefined) return null;
    const moved: Presentation = {
      ...entry,
      target,
      changes: [
        changeStyle(target, 'display', 'none'),
        ...entry.changes.filter((change) => change !== previous),
      ],
    };
    restoreStyle(previous);
    this.entries.set(entry.element, moved);
    return moved;
  }

  restoreNext():
    | {
        readonly restored: boolean;
        readonly retargeted: boolean;
        readonly root: Element | null;
        readonly element: Element;
      }
    | undefined {
    const element = this.pending.values().next().value;
    if (element === undefined) return undefined;
    this.pending.delete(element);
    const entry = this.entries.get(element);
    if (entry === undefined) return { restored: false, retargeted: false, root: null, element };
    const background =
      entry.debug || entry.kind === 'background'
        ? null
        : adBackgroundColorTarget(entry.element, entry.target, entry.kind);
    if (
      element.isConnected &&
      (entry.kind !== undefined || safePresentation(element)) &&
      (entry.target === element || isAdContainer(entry.target, entry.element)) &&
      fingerprint(element, entry.kind) === entry.fingerprint &&
      entry.changes.every(
        (change) =>
          // An ad script reapplying the colour we removed stays ours to clean; any other value
          // is a page-owned change that ends the presentation.
          (change.element === background &&
            change.property === 'background-color' &&
            change.element.style.getPropertyValue(change.property) === change.value) ||
          (change.element.style.getPropertyValue(change.property) === change.applied &&
            change.element.style.getPropertyPriority(change.property) === change.appliedPriority),
      )
    ) {
      const moved = this.retarget(entry);
      this.updateBackground(
        moved ?? entry,
        moved === null
          ? background
          : adBackgroundColorTarget(moved.element, moved.target, moved.kind),
      );
      return { restored: false, retargeted: moved !== null, root: null, element };
    }
    const root = entry.target.isConnected ? entry.target : element.isConnected ? element : null;
    return {
      element,
      restored: this.restore(element),
      retargeted: false,
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
