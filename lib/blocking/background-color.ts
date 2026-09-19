import { collectContentFeatures } from '../candidates/features';
import type { AdCandidate } from '../shared/types';

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
  if (kind !== undefined) return null;
  const body = element.ownerDocument.body;
  if (!(body instanceof HTMLElement) || body === element || body === target) return null;
  const color = body.style.getPropertyValue('background-color');
  if (color === '' || body.style.getPropertyPriority('background-color') !== 'important')
    return null;
  if (collectContentFeatures(element, true)?.labels.includes('advertisement') !== true) return null;
  const pending: Element[] = [target];
  for (let visited = 0; pending.length > 0 && visited < 80; visited++) {
    const current = pending.pop();
    if (current === undefined) break;
    if (
      current instanceof HTMLElement &&
      current.style.getPropertyValue('background-color') === color &&
      current.style.getPropertyPriority('background-color') === 'important'
    )
      return body;
    if (pending.length + current.children.length > 80) return null;
    pending.push(...current.children);
  }
  return null;
}
