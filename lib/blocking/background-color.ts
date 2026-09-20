import { collectContentFeatures } from '../candidates/features';
import type { AdCandidate } from '../shared/types';

const servedBackground = new WeakMap<Document, string>();

// The page colour a document is served with belongs to the site. A colour applied afterwards
// arrived with the advertising being removed, whatever markup carries it.
export function capturePageBackground(document: Document): void {
  if (servedBackground.has(document)) return;
  const body: unknown = document.body;
  if (body instanceof HTMLElement) {
    servedBackground.set(document, body.style.getPropertyValue('background-color'));
    return;
  }
  const root: unknown = document.documentElement;
  if (!(root instanceof HTMLElement)) return;
  const observer = new MutationObserver(() => {
    const element: unknown = document.body;
    if (!(element instanceof HTMLElement)) return;
    servedBackground.set(document, element.style.getPropertyValue('background-color'));
    observer.disconnect();
  });
  observer.observe(root, { childList: true });
}

export function adBackgroundVariables(
  element: HTMLElement,
  target: HTMLElement,
): readonly string[] {
  const body = element.ownerDocument.body;
  const view = element.ownerDocument.defaultView;
  if (
    view === null ||
    !(body instanceof HTMLElement) ||
    collectContentFeatures(element, true)?.labels.includes('advertisement') !== true
  )
    return [];
  const variables = new Set<string>();
  const bodyStyle = view.getComputedStyle(body);
  for (const style of target.querySelectorAll('style')) {
    const mount = style.parentElement;
    if (
      mount?.style.getPropertyPriority('background-color') !== 'important' ||
      mount.style.getPropertyValue('background-color') !== bodyStyle.backgroundColor
    )
      continue;
    for (const rule of style.sheet?.cssRules ?? []) {
      if (!(rule instanceof CSSStyleRule) || rule.selectorText !== 'body') continue;
      for (const property of rule.style) {
        if (
          /^--[\w-]*background[\w-]*$/iu.test(property) &&
          rule.style.getPropertyValue(property).trim() ===
            bodyStyle.getPropertyValue(property).trim()
        )
          variables.add(property);
      }
    }
  }
  return [...variables];
}

export function adBackgroundColorTarget(
  element: HTMLElement,
  target: HTMLElement,
  kind: AdCandidate['kind'],
): HTMLElement | null {
  if (kind === 'background')
    return element.style.getPropertyValue('background-color') === '' ? null : element;
  if (kind !== undefined && kind !== 'ad-slot') return null;
  const body = element.ownerDocument.body;
  if (!(body instanceof HTMLElement) || body === element || body === target) return null;
  const served = servedBackground.get(element.ownerDocument);
  const color = body.style.getPropertyValue('background-color');
  if (color === '' || served === undefined || color === served) return null;
  return collectContentFeatures(element, true)?.labels.includes('advertisement') === true
    ? body
    : null;
}
