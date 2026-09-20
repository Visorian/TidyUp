import { isSafeCandidateBoundary } from '../candidates/visibility';

const ESSENTIAL =
  'article,main,nav,header,footer,form,input,textarea,select,button,h1,h2,h3,h4,h5,h6,[contenteditable],[role]:not([role="presentation"]):not([role="none"])';
// Advertising wrappers keep these words in their id or class while state classes come and go.
const SLOT_WORD =
  /^(?:ads?|advert(?:s|ising|isement)?|adslot|adunit|adserver|anzeige|werbung|reklame|banner|slot|sponsor(?:ed)?|promo(?:tion)?|gpt|dfp|skyscraper|fireplace)$/iu;
// Identifiers carrying a generated counter differ on every load and cannot anchor a locator.
const GENERATED = /\d{4,}|[\da-f]{8,}/iu;

// Sites wrap placements in their own custom elements, which always carry a dash in the tag name.
export function isSlotElement(element: Element): boolean {
  return element.matches('div,section,aside,ins') || element.localName.includes('-');
}

function slotWords(value: string): string[] {
  return value
    .replaceAll(/([a-z])([A-Z])/gu, '$1 $2')
    .split(/[^a-z\d]+/iu)
    .filter((word) => SLOT_WORD.test(word))
    .map((word) => word.toLowerCase());
}

export function isStableIdentifier(id: string): boolean {
  return id !== '' && !GENERATED.test(id);
}

// A generated identifier still opens with the part the site chose, which stays across loads.
export function stableIdentifierPrefix(id: string): string | null {
  const prefix = id.split(GENERATED)[0] ?? '';
  return prefix.length >= 4 && /^[\w-]+$/u.test(prefix) ? prefix : null;
}

export function adSlotFingerprint(element: Element): string | null {
  if (
    !isSlotElement(element) ||
    element.matches(ESSENTIAL) ||
    !isSafeCandidateBoundary(element) ||
    element.querySelector(ESSENTIAL) !== null
  )
    return null;
  // Only the advertising words survive, so a slot keeps its identity across creatives and loads.
  const words = [
    ...new Set(
      slotWords(
        `${element.localName} ${element.getAttribute('id') ?? ''} ${element.getAttribute('class') ?? ''}`,
      ),
    ),
  ].toSorted();
  if (words.length === 0) return null;
  return JSON.stringify([element.tagName.toLowerCase(), words]);
}

export function findAdSlot(element: HTMLElement, target: HTMLElement): HTMLElement | null {
  if (!target.contains(element)) return null;
  let current: HTMLElement | null = element;
  let outermost: HTMLElement | null = null;
  let identified: HTMLElement | null = null;
  for (let depth = 0; current !== null && depth < 9; depth++) {
    if (adSlotFingerprint(current) !== null) {
      outermost = current;
      if (identified === null && isStableIdentifier(current.id)) identified = current;
    }
    if (current === target) return identified ?? outermost;
    current = current.parentElement;
  }
  return null;
}
