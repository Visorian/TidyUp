import { presentationFingerprint } from '../candidates/fingerprint';
import { isSafeCandidateBoundary } from '../candidates/visibility';

interface Presentation {
  readonly element: HTMLElement;
  readonly property: 'display' | 'outline';
  readonly value: string;
  readonly priority: string;
  readonly fingerprint: string;
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

  get hasPending(): boolean {
    return this.pending.size > 0;
  }

  has(element: Element): boolean {
    return this.entries.has(element);
  }

  apply(element: Element, probability: number, threshold: number, debug: boolean): boolean {
    if (
      !(element instanceof HTMLElement) ||
      this.entries.has(element) ||
      this.entries.size >= 512 ||
      !safePresentation(element)
    )
      return false;
    if (!debug && probability < threshold) return false;
    const fingerprint = presentationFingerprint(element);
    if (fingerprint === null) return false;
    const property = debug ? 'outline' : 'display';
    this.entries.set(element, {
      element,
      property,
      fingerprint,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    });
    const color = probability >= threshold ? '#dc2626' : probability <= 0.1 ? '#16a34a' : '#ca8a04';
    element.style.setProperty(property, debug ? `3px solid ${color}` : 'none', 'important');
    return !debug;
  }

  restore(element: Element): boolean {
    this.pending.delete(element);
    const entry = this.entries.get(element);
    if (entry === undefined) return false;
    if (entry.value === '') entry.element.style.removeProperty(entry.property);
    else entry.element.style.setProperty(entry.property, entry.value, entry.priority);
    this.entries.delete(element);
    return entry.property === 'display';
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

  restoreNext(): { readonly restored: boolean; readonly root: Element | null } | undefined {
    const element = this.pending.values().next().value;
    if (element === undefined) return undefined;
    this.pending.delete(element);
    const entry = this.entries.get(element);
    if (
      entry === undefined ||
      (element.isConnected &&
        safePresentation(element) &&
        presentationFingerprint(element) === entry.fingerprint)
    )
      return { restored: false, root: null };
    return {
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
    ],
  });
}
