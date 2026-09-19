import { afterEach, expect, it, vi } from 'vitest';
import { generatedAdLabel } from '../lib/candidates/features';

class LabelElement {
  readonly ownerDocument = {
    defaultView: {
      getComputedStyle: (_element: unknown, pseudo: string): Readonly<Record<string, string>> => ({
        content: pseudo === '::before' ? this.before : this.after,
        display: this.display,
        visibility: this.visibility,
        opacity: this.opacity,
      }),
    },
  };
  before = 'none';
  after = 'none';
  display = 'block';
  visibility = 'visible';
  opacity = '1';
}

function readLabel(fixture: unknown): string {
  vi.stubGlobal('Element', LabelElement);
  if (!(fixture instanceof Element)) throw new Error('Expected label fixture');
  return generatedAdLabel(fixture);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each(['Anzeige', 'Advertisement', 'Werbung'])('reads rendered %s labels', (label) => {
  const fixture = new LabelElement();
  fixture.before = `"${label}"`;
  expect(readLabel(fixture)).toBe(label);
});

it('reads an after label when before contains decoration', () => {
  const fixture = new LabelElement();
  fixture.before = '"•"';
  fixture.after = '"Anzeige"';
  expect(readLabel(fixture)).toBe('Anzeige');
});

it.each(['display', 'visibility', 'opacity'] as const)('ignores hidden labels: %s', (property) => {
  const fixture = new LabelElement();
  fixture.before = '"Anzeige"';
  const hidden = { display: 'none', visibility: 'hidden', opacity: '0' };
  fixture[property] = hidden[property];
  expect(readLabel(fixture)).toBe('');
});

it.each(['none', '""', '"Private account: 1234"', 'url("tracking.png")', '"Anzeige lesen"'])(
  'does not collect unrelated generated content: %s',
  (content) => {
    const fixture = new LabelElement();
    fixture.before = content;
    expect(readLabel(fixture)).toBe('');
  },
);
