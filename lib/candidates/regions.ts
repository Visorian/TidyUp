import { cachedBoolean, computedStyle } from './read-cache';
import type { AdCandidate } from '../shared/types';
import {
  type CandidateContent,
  displayFeatures,
  elementDescription,
  linkedHost,
  metadataLabels,
  nextOutsideSubtree,
  safeHost,
  sanitizeText,
  signalLabels,
} from './features';
import {
  composedParent,
  hasPrivateAncestor,
  INERT_ELEMENTS,
  isHidden,
  isPrivateElement,
  isVisible,
} from './visibility';

const DIALOG = 'dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"]';
const ESSENTIAL =
  'html,body,main,nav,article,[role="main"],[role="navigation"],[role="article"],[role="application"]';
const CONSENT =
  /\b(?:cookies?|consent|privacy|tracking|einwilligung\w*|zustimmung\w*|datenschutz\w*)\b/iu;

function isOverlay(element: Element): boolean {
  return cachedBoolean(element, 'overlay', () => overlay(element));
}

function overlay(element: Element): boolean {
  if (element.matches('dialog,header,footer') || element.matches(ESSENTIAL)) return false;
  if (element.matches(DIALOG)) return true;
  const position = computedStyle(element)?.position;
  return position === 'fixed' || position === 'sticky';
}

function overlayNodes(element: Element, hiddenRoot: boolean): readonly Node[] | null {
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  const nodes: Node[] = [];
  let characters = 0;
  let node: Node | null = element;
  for (let visited = 0; node !== null && visited < 240; visited += 1) {
    if (node instanceof Element) {
      if (
        (isPrivateElement(node) && !node.matches(INERT_ELEMENTS)) ||
        node.shadowRoot !== null ||
        node instanceof HTMLSlotElement ||
        node.matches(ESSENTIAL) ||
        node.matches('dialog')
      )
        return null;
      if (node.matches(INERT_ELEMENTS) || (!(hiddenRoot && node === element) && isHidden(node))) {
        node = nextOutsideSubtree(walker, element);
        continue;
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      characters += node.nodeValue?.length ?? 0;
      if (characters > 8_000) return null;
    }
    nodes.push(node);
    node = walker.nextNode();
  }
  return node === null ? nodes : null;
}

function overlayContent(element: Element, hiddenRoot = false): CandidateContent | null {
  if (!isOverlay(element) || hasPrivateAncestor(element)) return null;
  const nodes = overlayNodes(element, hiddenRoot);
  if (nodes === null) return null;
  const modal = element.matches(DIALOG);
  const text: string[] = [];
  const labels = new Set(metadataLabels(element));
  const hosts = new Set<string>();
  const descriptions = new Set<string>();
  let frames = 0;
  let images = 0;
  let consent = false;
  for (const node of nodes) {
    if (node instanceof Element) {
      if (node instanceof HTMLIFrameElement) frames = Math.min(frames + 1, 80);
      if (node instanceof HTMLImageElement) images = Math.min(images + 1, 80);
      if (node === element || node.matches('img,iframe')) {
        const description = elementDescription(node);
        consent ||= CONSENT.test(description);
        if (description !== '' && descriptions.size < 2) descriptions.add(description);
        for (const label of metadataLabels(node)) labels.add(label);
      }
      const host = linkedHost(node);
      if (host !== null && hosts.size < 8) hosts.add(host);
    } else if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue ?? '';
      consent ||= CONSENT.test(value);
      text.push(value);
    }
  }
  // Modal dialogs are summarized whenever they are safe to read, so rules can reach prompts
  // that never mention consent. Other overlays stay ordinary candidates unless they do.
  if (!consent && !modal) return null;
  const normalized = sanitizeText(text.join(' '));
  for (const label of signalLabels(normalized)) labels.add(label);
  if (modal) labels.add('modal dialog');
  if (consent) labels.add('consent overlay');
  return {
    text: normalized,
    labels: [...labels].toSorted(),
    descriptions: [...descriptions],
    linkHosts: [...hosts].toSorted(),
    frames,
    images,
  };
}

export function hasOverlayAncestor(element: Element): boolean {
  return cachedBoolean(element, 'overlay-ancestor', () => overlayAncestor(element));
}

function overlayAncestor(element: Element): boolean {
  let parent = composedParent(element);
  for (let depth = 0; parent !== null && depth < 64; depth += 1) {
    if (parent.matches(DIALOG) || (isOverlay(parent) && overlayContent(parent) !== null))
      return true;
    parent = composedParent(parent);
  }
  return parent !== null;
}

function isBackgroundContainer(element: Element): boolean {
  if (element.matches('html,body')) return true;
  if (!element.matches('div,section') || element.childElementCount === 0) return false;
  const view = element.ownerDocument.defaultView;
  if (view === null) return false;
  const bounds = element.getBoundingClientRect();
  return (
    element.querySelector('main,[role="main"]') !== null ||
    (bounds.width >= view.innerWidth * 0.8 && bounds.height >= view.innerHeight * 0.6)
  );
}

function backgroundHosts(element: Element, background: string): readonly string[] {
  const hosts = new Set<string>();
  for (const match of background.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/giu)) {
    const value = match[1];
    if (value === undefined) continue;
    const host = safeHost(value.trim(), element.ownerDocument.baseURI);
    if (host !== null && hosts.size < 8) hosts.add(host);
  }
  return [...hosts].toSorted();
}

export function extractSpecialCandidate(
  element: Element,
  id: string,
  pageHost: string,
): AdCandidate | null {
  const background = element.matches('html,body,div,section')
    ? computedStyle(element)?.backgroundImage
    : undefined;
  const hasBackground = background !== undefined && /url\(/iu.test(background);
  if (!hasBackground && !isOverlay(element)) return null;
  if (hasPrivateAncestor(element) || !isVisible(element) || hasOverlayAncestor(element))
    return null;
  const selection = element.ownerDocument.getSelection();
  if (selection !== null && !selection.isCollapsed && selection.containsNode(element, true))
    return null;
  const content = overlayContent(element);
  if (content !== null) {
    const { frames, images, ...features } = content;
    return {
      id,
      kind: 'overlay',
      tag: element.tagName.toLowerCase(),
      pageHost,
      ...features,
      display: displayFeatures(element, content.text, frames, images),
    };
  }
  if (!hasBackground || background === undefined || !isBackgroundContainer(element)) return null;
  const description = elementDescription(element);
  return {
    id,
    kind: 'background',
    tag: element.tagName.toLowerCase(),
    pageHost,
    text: '',
    labels: [...new Set([...metadataLabels(element), 'page background'])].toSorted(),
    descriptions: description === '' ? [] : [description],
    linkHosts: backgroundHosts(element, background),
    display: displayFeatures(element, '', 0, 0),
  };
}

export function specialPresentationFingerprint(
  element: Element,
  kind: 'overlay' | 'background',
): string | null {
  if (hasPrivateAncestor(element)) return null;
  if (kind === 'overlay') {
    const content = overlayContent(element, true);
    return content === null ? null : JSON.stringify(content);
  }
  if (!isBackgroundContainer(element)) return null;
  return JSON.stringify([
    element.getAttribute('id'),
    element.getAttribute('class'),
    elementDescription(element),
    metadataLabels(element),
  ]);
}
