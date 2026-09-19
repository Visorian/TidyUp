import { collectContentFeatures } from '../candidates/features';
import type { AdCandidate } from '../shared/types';

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
