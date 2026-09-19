/* oxlint-disable eslint/max-classes-per-file -- Minimal DOM doubles exercise wrapper selection without a browser dependency. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type * as CandidateFeatures from '../lib/candidates/features';
import { findAdContainer, isAdContainer } from '../lib/blocking/ad-container';

vi.mock('../lib/candidates/features', async (importOriginal) => ({
  ...(await importOriginal<typeof CandidateFeatures>()),
  collectContentFeatures: (element: Element) => ({
    labels: element.getAttribute('test-ad') === 'true' ? ['advertisement'] : [],
  }),
}));

vi.mock('../lib/candidates/visibility', () => ({
  INERT_ELEMENTS: 'script,style,template,noscript',
  isSafeCandidateBoundary: (element: Element) => element.getAttribute('test-unsafe') !== 'true',
}));

class TestText {
  readonly nodeType = 3;
  constructor(readonly nodeValue: string) {}
}

class TestElement {
  readonly nodeType = 1;
  readonly childNodes: Node[] = [];
  readonly parentElement: HTMLElement | null = null;
  private readonly attributes = new Map<string, string>();
  readonly ownerDocument = {
    defaultView: {
      getComputedStyle: (element: Element, pseudo?: string): Readonly<Record<string, string>> => ({
        backgroundImage: element.getAttribute(`background${pseudo ?? ''}`) ?? 'none',
        content: pseudo === undefined ? 'normal' : (element.getAttribute(pseudo) ?? 'none'),
        display: element.getAttribute('display') ?? 'block',
      }),
    },
  };
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  matches(selector: string): boolean {
    if (selector.startsWith('[contenteditable]'))
      return (
        this.attributes.has('contenteditable') ||
        this.attributes.has('tabindex') ||
        (this.attributes.has('role') &&
          !['none', 'presentation'].includes(this.attributes.get('role') ?? ''))
      );
    return selector.split(',').includes(this.getAttribute('tag') ?? 'div');
  }
  append(...nodes: readonly (Node | string)[]): void {
    for (const value of nodes) {
      const node = typeof value === 'string' ? new Text(value) : value;
      Object.defineProperty(node, 'parentElement', { configurable: true, value: this });
      this.childNodes.push(node);
    }
  }
  contains(node: Node | null): boolean {
    return this.childNodes.some(
      (child) => child === node || (child instanceof HTMLElement && child.contains(node)),
    );
  }
}

beforeEach(() => {
  vi.stubGlobal('HTMLElement', TestElement);
  vi.stubGlobal('Text', TestText);
  vi.stubGlobal('Node', { TEXT_NODE: 3, COMMENT_NODE: 8 });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function createNode(tag = 'div', ...children: readonly (Node | string)[]): HTMLElement {
  const element = new HTMLElement();
  element.setAttribute('tag', tag);
  element.append(...children);
  return element;
}

function advertisement(): HTMLElement {
  const element = createNode('div', createNode('a', 'Buy this product'));
  element.setAttribute('test-ad', 'true');
  return element;
}

it('selects a reserved ad wrapper including empty space and the CSS Anzeige label', () => {
  const ad = advertisement();
  const label = createNode('span');
  label.setAttribute('::before', '"Anzeige"');
  const spinner = createNode('div');
  spinner.setAttribute('display', 'none');
  const hull = createNode('div', spinner, label, ad, createNode('script', 'advertising();'));
  const tile = createNode('div', createNode('div', hull));
  createNode('main', tile, createNode('article', 'Keep this article'));
  expect(findAdContainer(ad)).toBe(tile);
});

it('leaves regions without advertisement evidence at their classified boundary', () => {
  const region = createNode('div', 'Newsletter subscription');
  createNode('aside', region);
  expect(findAdContainer(region)).toBe(region);
});

it.each(['main', 'nav', 'header', 'footer', 'article', 'form', 'body', 'html'])(
  'stops before an essential %s ancestor',
  (tag) => {
    const ad = advertisement();
    createNode(tag, ad);
    expect(findAdContainer(ad)).toBe(ad);
  },
);

it.each(['a', 'img', 'input', 'button', 'iframe', 'svg'])(
  'keeps sibling %s content visible, even when empty or hidden',
  (tag) => {
    const ad = advertisement();
    const sibling = createNode(tag);
    sibling.setAttribute('display', 'none');
    createNode('aside', ad, sibling);
    expect(findAdContainer(ad)).toBe(ad);
  },
);

it('stops promotion at real sibling text while collapsing an inner ad-only hull', () => {
  const ad = advertisement();
  const hull = createNode('div', ad, createNode('span', 'Anzeige'));
  createNode('section', hull, createNode('span', 'Latest news'));
  expect(findAdContainer(ad)).toBe(hull);
});

it('collapses an ad placement containing a hidden zero-sized blank measurement frame', () => {
  const ad = advertisement();
  const measurement = createNode('iframe');
  measurement.setAttribute('width', '0');
  measurement.setAttribute('height', '0');
  measurement.setAttribute('src', 'about:blank');
  measurement.setAttribute('display', 'none');
  const wrapper = createNode(
    'div',
    createNode('div', ad, measurement),
    createNode('span', 'Anzeige'),
  );
  expect(findAdContainer(ad)).toBe(wrapper);
  measurement.setAttribute('display', 'block');
  expect(isAdContainer(wrapper, ad)).toBe(false);
});

it.each([
  ['width', '300'],
  ['height', '250'],
  ['src', 'https://example.com/widget'],
  ['srcdoc', '<p>Content</p>'],
  ['tabindex', '0'],
])('preserves a sibling frame with %s=%s', (attribute, value) => {
  const ad = advertisement();
  const frame = createNode('iframe');
  frame.setAttribute('width', '0');
  frame.setAttribute('height', '0');
  frame.setAttribute('src', 'about:blank');
  frame.setAttribute('display', 'none');
  frame.setAttribute(attribute, value);
  createNode('div', ad, frame);
  expect(findAdContainer(ad)).toBe(ad);
});

it.each(['background', 'background::before', 'background::after'])(
  'preserves sibling background artwork in %s',
  (attribute) => {
    const ad = advertisement();
    const sibling = createNode('span');
    sibling.setAttribute(attribute, 'url("artwork.png")');
    createNode('div', ad, sibling);
    expect(findAdContainer(ad)).toBe(ad);
  },
);

it('rejects arbitrary generated text and preserves semantic or interactive wrappers', () => {
  const ad = advertisement();
  const wrapper = createNode('div', ad);
  wrapper.setAttribute('::after', '"Latest headlines"');
  expect(findAdContainer(ad)).toBe(ad);
  wrapper.setAttribute('::after', 'none');
  wrapper.setAttribute('role', 'dialog');
  expect(findAdContainer(ad)).toBe(ad);
});

it('revalidates content inserted inside a hidden wrapper instead of skipping hidden siblings', () => {
  const ad = advertisement();
  const wrapper = createNode('div', ad);
  expect(findAdContainer(ad)).toBe(wrapper);
  wrapper.setAttribute('display', 'none');
  const sibling = createNode('div');
  wrapper.append(sibling);
  expect(isAdContainer(wrapper, ad)).toBe(true);
  sibling.append('New editorial content');
  expect(isAdContainer(wrapper, ad)).toBe(false);
});

it('rejects unsafe candidate boundaries and bounds both wrapper depth and sibling inspection', () => {
  const ad = advertisement();
  const unsafe = createNode('div', ad);
  unsafe.setAttribute('test-unsafe', 'true');
  expect(findAdContainer(ad)).toBe(ad);
  unsafe.setAttribute('test-unsafe', 'false');
  let eighth = ad;
  for (let depth = 0; depth < 8; depth++) eighth = createNode('div', eighth);
  const ninth = createNode('div', eighth);
  expect(findAdContainer(ad)).toBe(eighth);
  expect(isAdContainer(ninth, ad)).toBe(false);
  const wide = createNode('div', ad, ...Array.from({ length: 81 }, () => createNode('span')));
  expect(isAdContainer(wide, ad)).toBe(false);
});
