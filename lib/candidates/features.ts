import { cachedAdLabel, computedStyle } from './read-cache';
import { LIMITS } from '../config/defaults';
import type { CandidateDisplay } from '../shared/types';
import { isPublicHost } from '../shared/validation';
import { INERT_ELEMENTS, isHidden, isPrivateElement, isSafeCandidateBoundary } from './visibility';

const SIGNALS: readonly (readonly [string, RegExp])[] = [
  [
    'sponsored',
    /\b(?:sponsor(?:ed|isé|isé[e]?|izzato|ed content)?|gesponsert|patrocinad[oa]|sponsorizzato)\b/iu,
  ],
  [
    'advertisement',
    /\b(?:ad(?:s|vert|vertisement|vertising|slot|frame|container|banner)?|werbung|anzeige|publicité|publicidad|pubblicità|anúncio|reklame|reklama|реклама)\b|広告|广告|廣告|광고/iu,
  ],
  ['promoted', /\b(?:promoted|promotion|promocionado|promu|commercial|advertorial)\b/iu],
  [
    'paid partnership',
    /\b(?:paid partnership|paid recommendation|partner content|in partnership with|bezahlte partnerschaft|partenariat rémunéré)\b/iu,
  ],
  ['affiliate', /\b(?:affiliate|affilié|afiliado)\b/iu],
  ['shop now', /\b(?:shop now|buy now|jetzt kaufen|acheter maintenant|comprar ahora)\b/iu],
];

export function isAdvertisementLabel(text: string): boolean {
  return /^(?:anzeige|werbung|advertisement|advertising|publicité|publicidad|pubblicità|anúncio|reklame|reklama|реклама|広告|广告|廣告|광고)\s*:?$/iu.test(
    text.trim(),
  );
}

export function generatedAdLabel(element: Element): string {
  return cachedAdLabel(element, () => generatedLabel(element));
}

function generatedLabel(element: Element): string {
  const view = element.ownerDocument.defaultView;
  if (view === null) return '';
  for (const pseudo of ['::before', '::after']) {
    const style = computedStyle(element, pseudo);
    if (style === undefined) continue;
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
      continue;
    const content = style.content.trim();
    const quote = content[0];
    if ((quote !== '"' && quote !== "'") || content.at(-1) !== quote) continue;
    const text = content.slice(1, -1).trim();
    if (isAdvertisementLabel(text)) return text;
  }
  return '';
}

export function signalLabels(text: string): string[] {
  const labels: string[] = [];
  for (const [label, expression] of SIGNALS) {
    if (expression.test(text)) labels.push(label);
  }
  return labels;
}

export function metadataLabels(element: Element): string[] {
  const values = ['id', 'class', 'aria-label', 'title'].map((name) =>
    (element.getAttribute(name) ?? '').slice(0, 256),
  );
  const dataNames = element
    .getAttributeNames()
    .slice(0, 24)
    .filter((name) => name.startsWith('data-'));
  return signalLabels(
    [...values, ...dataNames]
      .join(' ')
      .replaceAll(/([a-z])([A-Z])/gu, '$1 $2')
      .replaceAll(/[_-]/gu, ' '),
  );
}

export function sanitizeText(text: string): string {
  return text
    .replaceAll(/(?:https?:\/\/|www\.)[^\s<>]+/giu, '[link]')
    .replaceAll(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, '[email]')
    .replaceAll(
      /\b(?:bearer\s+\S+|(?:token|password|secret|authorization|api[_-]?key)\s*[:=]\s*\S+)/giu,
      '[redacted]',
    )
    .replaceAll(/[?#][^\s<>]+/gu, '')
    .replaceAll(/\b[\w+/-]{24,}={0,2}\b/gu, '[redacted]')
    .replaceAll(/\b(?:\d[ -]?){12,}\b/gu, '[redacted]')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .slice(0, LIMITS.text);
}

export function safeHost(value: string, base: string): string | null {
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return isPublicHost(url.hostname) ? url.hostname : null;
  } catch {
    return null;
  }
}

export interface CandidateFeatures {
  readonly text: string;
  readonly labels: readonly string[];
  readonly linkHosts: readonly string[];
  readonly descriptions: readonly string[];
  readonly display: CandidateDisplay;
}

export function elementDescription(element: Element): string {
  return sanitizeText(
    [element.getAttribute('alt'), element.getAttribute('title'), element.getAttribute('aria-label')]
      .filter((value) => value !== null)
      .join(' '),
  ).slice(0, 96);
}

export function linkedHost(element: Element): string | null {
  const link =
    element instanceof HTMLAnchorElement
      ? element.getAttribute('href')
      : element instanceof HTMLIFrameElement
        ? element.getAttribute('src')
        : null;
  return link === null ? null : safeHost(link, element.ownerDocument.baseURI);
}

export function displayFeatures(
  element: Element,
  text: string,
  frames: number,
  images: number,
): CandidateDisplay {
  const style = computedStyle(element);
  const bounds = element.getBoundingClientRect();
  const position = style?.position;
  const view = element.ownerDocument.defaultView;
  return {
    position:
      position === 'fixed' || position === 'sticky' || position === 'absolute' ? position : 'flow',
    shape:
      bounds.width > bounds.height * 2 ? 'wide' : bounds.height > bounds.width * 2 ? 'tall' : 'box',
    frames,
    images,
    backgroundImage: style !== undefined && style.backgroundImage !== 'none',
    labelOnly: text === '' || isAdvertisementLabel(text),
    // Page skins and interstitials are otherwise indistinguishable from an ordinary frame.
    fullViewport:
      view !== null &&
      bounds.width >= view.innerWidth * 0.9 &&
      bounds.height >= view.innerHeight * 0.9,
  };
}

export const CARD_CONTAINERS =
  'article,aside,li,[role="article"],[role="listitem"],.card,.feed-card,.post,.story,.teaser,.tile';

function collectNodes(element: Element, hiddenRoot: boolean): readonly Node[] | null {
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  const nodes: Node[] = [];
  let characters = 0;
  let node: Node | null = element;
  for (let visited = 0; node !== null && visited < 80; visited += 1) {
    if (node instanceof Element) {
      if (node.matches(INERT_ELEMENTS) || (!(hiddenRoot && node === element) && isHidden(node))) {
        node = nextOutsideSubtree(walker, element);
        continue;
      }
      if (isPrivateElement(node) || (node !== element && node.matches(CARD_CONTAINERS)))
        return null;
    } else if (node.nodeType === Node.TEXT_NODE) {
      characters += node.nodeValue?.length ?? 0;
      if (characters > 1_200) return null;
    }
    nodes.push(node);
    node = walker.nextNode();
  }
  // Larger containers are left for the scanner to reach their individual cards.
  return node === null ? nodes : null;
}

export interface CandidateContent {
  readonly text: string;
  readonly labels: readonly string[];
  readonly linkHosts: readonly string[];
  readonly descriptions: readonly string[];
  readonly frames: number;
  readonly images: number;
}

export function collectContentFeatures(
  element: Element,
  hiddenRoot = false,
): CandidateContent | null {
  if (!isSafeCandidateBoundary(element)) return null;
  const nodes = collectNodes(element, hiddenRoot);
  if (nodes === null) return null;
  const labels = new Set(metadataLabels(element));
  const hosts = new Set<string>();
  const descriptions = new Set<string>();
  const text: string[] = [];
  let frames = 0;
  let images = 0;
  for (const node of nodes) {
    if (node instanceof Element) {
      const generated = generatedAdLabel(node);
      if (generated !== '') text.push(generated);
      if (node instanceof HTMLIFrameElement) frames++;
      if (node instanceof HTMLImageElement) images++;
      if (node === element || node.matches('img,iframe')) {
        for (const label of metadataLabels(node)) labels.add(label);
        const description = elementDescription(node);
        if (description !== '' && descriptions.size < 2) descriptions.add(description);
      }
      const host = linkedHost(node);
      if (host !== null && hosts.size < 8) hosts.add(host);
    } else if (node.nodeType === Node.TEXT_NODE) {
      text.push(node.nodeValue ?? '');
    }
  }
  const content = finishFeatures(text, [...labels], [...hosts]);
  return content === null
    ? null
    : {
        ...content,
        descriptions: [...descriptions],
        frames,
        images,
      };
}

export function collectFeatures(element: Element): CandidateFeatures | null {
  const content = collectContentFeatures(element);
  if (content === null) return null;
  const { frames, images, ...features } = content;
  return {
    ...features,
    display: displayFeatures(element, content.text, frames, images),
  };
}

export function nextOutsideSubtree(walker: TreeWalker, root: Element): Node | null {
  while (walker.nextSibling() === null) {
    if (walker.parentNode() === null || walker.currentNode === root) return null;
  }
  return walker.currentNode;
}

function finishFeatures(
  text: readonly string[],
  labels: readonly string[],
  hosts: readonly string[],
): Pick<CandidateFeatures, 'text' | 'labels' | 'linkHosts'> | null {
  const normalized = text.join(' ').replaceAll(/\s+/gu, ' ').trim();
  if (normalized.length > LIMITS.text) return null;
  const content = sanitizeText(normalized);
  const allLabels = new Set([...labels, ...signalLabels(content)]);
  return { text: content, labels: [...allLabels].toSorted(), linkHosts: [...hosts].toSorted() };
}
