import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { generatedAdLabel } from '../lib/candidates/features';
import {
  CandidateReadCache,
  computedStyle,
  withCandidateReads,
} from '../lib/candidates/read-cache';
import { isHidden, isPrivateElement } from '../lib/candidates/visibility';

class ReadElement {
  readonly assignedSlot = null;
  readonly parentElement = null;
  privateField = false;
  display = 'block';
  label = '"Anzeige"';
  readonly ownerDocument = {
    defaultView: {
      getComputedStyle: vi.fn<
        (_element: unknown, pseudo: string | null) => Readonly<Record<string, string>>
      >((_element, pseudo) => ({
        display: this.display,
        visibility: 'visible',
        opacity: '1',
        contentVisibility: 'visible',
        content: pseudo === '::before' ? this.label : 'none',
      })),
    },
  };
  hasAttribute(): boolean {
    return false;
  }
  getAttribute(): null {
    return null;
  }
  matches(): boolean {
    return this.privateField;
  }
}

function element(fixture: unknown): Element {
  if (!(fixture instanceof Element)) throw new Error('Expected read fixture');
  return fixture;
}

beforeEach(() => {
  vi.stubGlobal('Element', ReadElement);
  vi.stubGlobal('HTMLSlotElement', ReadElement);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it('shares style and generated-label reads during one synchronous phase', () => {
  const fixture = new ReadElement();
  const node = element(fixture);
  withCandidateReads(new CandidateReadCache(), () => {
    expect(isHidden(node)).toBe(false);
    expect(computedStyle(node)?.display).toBe('block');
    expect(isHidden(node)).toBe(false);
    expect(generatedAdLabel(node)).toBe('Anzeige');
    expect(generatedAdLabel(node)).toBe('Anzeige');
  });
  expect(fixture.ownerDocument.defaultView.getComputedStyle).toHaveBeenCalledTimes(2);
});

it('uses fresh visibility and privacy checks outside the shared read phase', () => {
  const fixture = new ReadElement();
  const node = element(fixture);
  withCandidateReads(new CandidateReadCache(), () => {
    expect(isHidden(node)).toBe(false);
    expect(isPrivateElement(node)).toBe(false);
  });
  fixture.display = 'none';
  fixture.privateField = true;
  expect(isHidden(node)).toBe(true);
  expect(isPrivateElement(node)).toBe(true);
});

it('invalidates visibility, generated text, and privacy after a presentation change', () => {
  const fixture = new ReadElement();
  const node = element(fixture);
  const reads = new CandidateReadCache();
  withCandidateReads(reads, () => {
    expect(isHidden(node)).toBe(false);
    expect(isPrivateElement(node)).toBe(false);
    expect(generatedAdLabel(node)).toBe('Anzeige');
  });
  fixture.display = 'none';
  fixture.privateField = true;
  fixture.label = '"Advertisement"';
  reads.clear();
  withCandidateReads(reads, () => {
    expect(isHidden(node)).toBe(true);
    expect(isPrivateElement(node)).toBe(true);
    expect(generatedAdLabel(node)).toBe('');
  });
  fixture.display = 'block';
  expect(generatedAdLabel(node)).toBe('Advertisement');
});

it('releases the shared cache when extraction throws', () => {
  const fixture = new ReadElement();
  const node = element(fixture);
  expect(() =>
    withCandidateReads(new CandidateReadCache(), () => {
      isHidden(node);
      throw new Error('Extraction failed');
    }),
  ).toThrow('Extraction failed');
  fixture.display = 'none';
  expect(isHidden(node)).toBe(true);
});
