import { collectContentFeatures, isAdvertisementLabel } from '../candidates/features';
import { INERT_ELEMENTS, isSafeCandidateBoundary } from '../candidates/visibility';
import { adSlotFingerprint } from './ad-slot';

const CONTAINERS = 'div,section,aside,ins';
const EMPTY_ELEMENTS = `${CONTAINERS},span`;
const INTERACTIVE =
  '[contenteditable],[tabindex],[role]:not([role="presentation"]):not([role="none"])';
const MAX_DEPTH = 8;

export function findAdContainer(element: HTMLElement): HTMLElement {
  if (collectContentFeatures(element, true)?.labels.includes('advertisement') !== true)
    return element;
  let container = element;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const parent = container.parentElement;
    if (!(parent instanceof HTMLElement) || !isAdContainer(parent, element)) break;
    container = parent;
  }
  return container;
}

export function isAdContainer(container: HTMLElement, element: HTMLElement): boolean {
  if (container === element) return true;
  if (!container.contains(element) || !isSafeCandidateBoundary(container)) return false;
  let ancestor = element.parentElement;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (
      !(ancestor instanceof HTMLElement) ||
      !ancestor.matches(CONTAINERS) ||
      ancestor.matches(INTERACTIVE)
    )
      return false;
    if (ancestor === container) return hasOnlyAdSurroundings(container, element);
    ancestor = ancestor.parentElement;
  }
  return false;
}

function hasOnlyAdSurroundings(container: HTMLElement, element: HTMLElement): boolean {
  // A wrapper the site marks as an ad slot often holds neighbouring ad markup, such as a second
  // creative frame. Its own text still has to stay empty or an advertising label.
  const marked = adSlotFingerprint(container) !== null;
  const pending: Node[] = [container];
  for (let visited = 0; pending.length > 0 && visited < 80; visited++) {
    const node = pending.pop();
    if (node === undefined || node === element) continue;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue?.trim() ?? '';
      if (text !== '' && !isAdvertisementLabel(text)) return false;
      continue;
    }
    if (node.nodeType === Node.COMMENT_NODE) continue;
    if (!(node instanceof HTMLElement)) return false;
    if (node.matches(INERT_ELEMENTS)) continue;
    if (
      !marked &&
      !isMeasurementFrame(node) &&
      (!node.matches(EMPTY_ELEMENTS) || node.matches(INTERACTIVE) || !safeDecoration(node))
    )
      return false;
    if (pending.length + node.childNodes.length > 80) return false;
    pending.push(...node.childNodes);
  }
  return pending.length === 0;
}

function isMeasurementFrame(element: HTMLElement): boolean {
  return (
    element.matches('iframe') &&
    element.getAttribute('width') === '0' &&
    element.getAttribute('height') === '0' &&
    element.getAttribute('src') === 'about:blank' &&
    element.getAttribute('srcdoc') === null &&
    !element.matches(INTERACTIVE) &&
    element.ownerDocument.defaultView?.getComputedStyle(element).display === 'none'
  );
}

function safeDecoration(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  if (view === null || view.getComputedStyle(element).backgroundImage !== 'none') return false;
  for (const pseudo of ['::before', '::after']) {
    const style = view.getComputedStyle(element, pseudo);
    if (style.backgroundImage !== 'none') return false;
    const content = style.content.trim();
    if (content === '' || content === 'none' || content === 'normal') continue;
    const quote = content[0];
    if ((quote !== '"' && quote !== "'") || content.at(-1) !== quote) return false;
    const text = content.slice(1, -1).trim();
    if (text !== '' && !isAdvertisementLabel(text)) return false;
  }
  return true;
}
