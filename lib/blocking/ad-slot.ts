import { isSafeCandidateBoundary } from '../candidates/visibility';

const SLOT_MARKER = /(?:^|[-_])ad-?slot(?:$|[-_])/iu;
const ESSENTIAL =
  'article,main,nav,header,footer,form,input,textarea,select,button,h1,h2,h3,h4,h5,h6,[contenteditable],[role]:not([role="presentation"]):not([role="none"])';

export function adSlotFingerprint(element: Element): string | null {
  if (
    !element.matches('div,section,aside,ins') ||
    element.matches(ESSENTIAL) ||
    !isSafeCandidateBoundary(element) ||
    element.querySelector(ESSENTIAL) !== null
  )
    return null;
  const id = element.getAttribute('id') ?? '';
  const markers = [
    ...new Set(
      [id, ...(element.getAttribute('class') ?? '').split(/\s+/u)]
        .filter((token) => SLOT_MARKER.test(token))
        .map((token) => token.replace(/((?:^|[-_])ad-?slot)(?:[-_].*)?$/iu, '$1')),
    ),
  ].toSorted();
  if (markers.length === 0) return null;
  return JSON.stringify([element.tagName.toLowerCase(), id, markers]);
}

export function findAdSlot(element: HTMLElement, target: HTMLElement): HTMLElement | null {
  if (!target.contains(element)) return null;
  let current: HTMLElement | null = element;
  let outermost: HTMLElement | null = null;
  let identified: HTMLElement | null = null;
  for (let depth = 0; current !== null && depth < 9; depth++) {
    if (adSlotFingerprint(current) !== null) {
      outermost = current;
      if (identified === null && current.id !== '') identified = current;
    }
    if (current === target) return identified ?? outermost;
    current = current.parentElement;
  }
  return null;
}
