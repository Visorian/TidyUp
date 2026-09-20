import { CandidateReadCache, computedStyle, withCandidateReads } from './read-cache';
import type { AdCandidate } from '../shared/types';
import { CARD_CONTAINERS, collectFeatures, generatedAdLabel, metadataLabels } from './features';
import { extractSpecialCandidate, hasOverlayAncestor } from './regions';
import { hasPrivateAncestor, isVisible } from './visibility';

const CONTAINERS = 'div,section,article,aside,li,ins,iframe,a,[role="article"],[role="listitem"]';
const ESSENTIAL =
  'html,body,main,nav,header,footer,[role="main"],[role="navigation"],[role="dialog"],[role="alertdialog"],[role="application"]';

function hasContentBoundary(element: Element): boolean {
  if (element.matches(CARD_CONTAINERS + ',iframe,ins') || metadataLabels(element).length > 0)
    return true;
  const position = computedStyle(element)?.position;
  if (position === 'fixed' || position === 'sticky') return true;
  for (const child of element.childNodes) {
    if (child instanceof Element && child.matches('h1,h2,h3,h4,h5,h6,p,img,iframe,picture'))
      return true;
    if (child.nodeType === Node.TEXT_NODE && (child.nodeValue ?? '').trim().length >= 30)
      return true;
    if (child instanceof Element && generatedAdLabel(child) !== '') return true;
  }
  return false;
}

export function extractCandidate(
  element: Element,
  id: string,
  pageHost: string,
  reads: Readonly<CandidateReadCache> = new CandidateReadCache(),
): AdCandidate | null {
  return withCandidateReads(reads, () => extract(element, id, pageHost));
}

function extract(element: Element, id: string, pageHost: string): AdCandidate | null {
  const special = extractSpecialCandidate(element, id, pageHost);
  if (special !== null) return special;
  if (!element.matches(CONTAINERS) || element.matches(ESSENTIAL) || hasPrivateAncestor(element))
    return null;
  if (element.matches('dialog,[aria-modal="true"]') || hasOverlayAncestor(element)) return null;
  if (element.childNodes.length > 24 || !hasContentBoundary(element) || !isVisible(element))
    return null;
  const selection = element.ownerDocument.getSelection();
  if (selection !== null && !selection.isCollapsed && selection.containsNode(element, true))
    return null;
  const features = collectFeatures(element);
  if (features === null) return null;
  // Bare labels and short CTA links belong to their enclosing card.
  if (element.tagName !== 'IFRAME' && features.text.length < 30) {
    const bounds = element.getBoundingClientRect();
    if (
      (features.display.frames === 0 &&
        features.display.images === 0 &&
        !features.display.backgroundImage &&
        (element.tagName === 'A' ||
          !(features.display.labelOnly && features.labels.includes('advertisement')))) ||
      bounds.width < 120 ||
      bounds.height < 50
    )
      return null;
  }
  return { id, tag: element.tagName.toLowerCase(), pageHost, ...features };
}

export function* enumerateElements(root: Node): Generator<Element> {
  const walker =
    root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_ELEMENT) ??
    (root instanceof Document ? root.createTreeWalker(root, NodeFilter.SHOW_ELEMENT) : null);
  if (walker === null) return;
  if (root instanceof Element) {
    yield root;
    if (root.shadowRoot !== null) yield* enumerateElements(root.shadowRoot);
  }
  let node = walker.nextNode();
  while (node !== null) {
    if (node instanceof Element) {
      yield node;
      if (node.shadowRoot !== null) yield* enumerateElements(node.shadowRoot);
    }
    node = walker.nextNode();
  }
}
