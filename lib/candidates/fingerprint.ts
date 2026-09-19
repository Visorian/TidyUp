import type { AdCandidate } from '../shared/types';
import { collectContentFeatures } from './features';

export function candidateFingerprint(candidate: Readonly<AdCandidate>): string {
  return JSON.stringify([
    candidate.pageHost,
    candidate.tag,
    candidate.kind,
    candidate.text,
    candidate.labels,
    candidate.linkHosts,
    candidate.descriptions,
    candidate.display,
  ]);
}

export function presentationFingerprint(element: Element): string | null {
  // Display:none changes geometry, but positioning and media presence remain meaningful.
  const content = collectContentFeatures(element, true);
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (content === null || style === undefined) return null;
  const position = style.position;
  return JSON.stringify({
    ...content,
    position:
      position === 'fixed' || position === 'sticky' || position === 'absolute' ? position : 'flow',
    backgroundImage: style.backgroundImage !== 'none',
  });
}
