import { extractCandidate } from '../lib/candidates/extract';
import type { AdCandidate } from '../lib/shared/types';

export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function element(id: string): HTMLElement {
  const value = document.querySelector(`#${id}`);
  if (!(value instanceof HTMLElement)) throw new Error(`Missing fixture: ${id}`);
  return value;
}

export function candidate(id: string): AdCandidate {
  const value = extractCandidate(element(id), id, 'news.example.org');
  if (value === null) throw new Error(`Expected candidate: ${id}`);
  return value;
}
