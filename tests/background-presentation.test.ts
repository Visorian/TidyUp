/* oxlint-disable eslint/max-classes-per-file -- Element and CSS rule doubles exercise reversible stylesheet cleanup. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { capturePageBackground } from '../lib/blocking/background-color';
import { PresentationStore } from '../lib/blocking/hide';

const evidence = vi.hoisted(() => ({ advertisement: true }));
vi.mock('../lib/candidates/features', () => ({
  collectContentFeatures: () => ({ labels: evidence.advertisement ? ['advertisement'] : [] }),
}));
vi.mock('../lib/blocking/ad-container', () => ({
  findAdContainer: (element: {
    readonly parentElement: { readonly parentElement: unknown } | null;
  }) => (element.parentElement?.parentElement === null ? element : element.parentElement),
  isAdContainer: () => true,
}));
vi.mock('../lib/candidates/visibility', () => ({ isSafeCandidateBoundary: () => true }));
vi.mock('../lib/candidates/fingerprint', () => ({ presentationFingerprint: () => 'ad' }));
vi.mock('../lib/candidates/regions', () => ({
  extractSpecialCandidate: () => ({ kind: 'background' }),
  specialPresentationFingerprint: () => 'background',
}));

class FixtureDocument {
  body: FixtureElement | null = null;
  readonly defaultView = null;
  readonly location = { hostname: 'news.example.org' };
}

class FixtureElement {
  readonly localName = 'div';
  readonly isConnected = true;
  parentElement: FixtureElement | null = null;
  readonly children: FixtureElement[] = [];
  private readonly values = new Map<
    string,
    { readonly value: string; readonly priority: string }
  >();
  readonly style = {
    getPropertyValue: (name: string): string => this.values.get(name)?.value ?? '',
    getPropertyPriority: (name: string): string => this.values.get(name)?.priority ?? '',
    setProperty: (name: string, value: string, priority = ''): void => {
      if (value === '') this.values.delete(name);
      else this.values.set(name, { value, priority });
    },
    removeProperty: (name: string): void => {
      this.values.delete(name);
    },
  };
  constructor(
    readonly ownerDocument: {
      readonly body: unknown;
      readonly location: { readonly hostname: string };
    },
  ) {}
  matches(): boolean {
    return false;
  }
  querySelector(): null {
    return null;
  }
  contains(node: unknown): boolean {
    return (
      node === this ||
      (node instanceof FixtureElement &&
        node.parentElement !== null &&
        this.contains(node.parentElement))
    );
  }
}

function domElement(value: unknown): HTMLElement {
  if (!(value instanceof HTMLElement)) throw new Error('Expected fixture element');
  return value;
}

function domDocument(value: unknown): Document {
  if (!(value instanceof Document)) throw new Error('Expected fixture document');
  return value;
}

function fixture(servedColor = ''): {
  readonly store: PresentationStore;
  readonly ad: HTMLElement;
  readonly wrapper: HTMLElement;
  readonly body: HTMLElement;
} {
  const document = new FixtureDocument();
  const body = new FixtureElement(document);
  const wrapper = new FixtureElement(document);
  const ad = new FixtureElement(document);
  document.body = body;
  wrapper.parentElement = body;
  ad.parentElement = wrapper;
  wrapper.children.push(ad);
  body.children.push(wrapper);
  if (servedColor !== '') body.style.setProperty('background-color', servedColor);
  capturePageBackground(domDocument(document));
  if (servedColor === '') {
    body.style.setProperty('background-color', 'rgb(2, 74, 216)', 'important');
    wrapper.style.setProperty('background-color', 'rgb(2, 74, 216)', 'important');
  }
  return {
    store: new PresentationStore(),
    ad: domElement(ad),
    wrapper: domElement(wrapper),
    body: domElement(body),
  };
}

beforeEach(() => {
  vi.stubGlobal('HTMLElement', FixtureElement);
  vi.stubGlobal('Document', FixtureDocument);
  evidence.advertisement = true;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it('removes the paired inline creative color to expose site CSS and restores the exact value and priority', () => {
  const { store, ad, wrapper, body } = fixture();
  expect(store.apply(ad, 0.99, 0.9, false)).toBe(true);
  expect(wrapper.style.getPropertyValue('display')).toBe('none');
  expect(body.style.getPropertyValue('background-color')).toBe('');
  expect(body.style.getPropertyPriority('background-color')).toBe('');
  store.queueChanges([body]);
  expect(store.restoreNext()?.restored).toBe(false);
  expect(store.restoreAll()).toBe(1);
  expect(body.style.getPropertyValue('background-color')).toBe('rgb(2, 74, 216)');
  expect(body.style.getPropertyPriority('background-color')).toBe('important');
});

it.each(['important', ''])('removes a page color the ad applied with priority "%s"', (priority) => {
  const { store, ad, body } = fixture();
  body.style.setProperty('background-color', 'rgb(255, 204, 0)', priority);
  expect(store.apply(ad, 0.99, 0.9, false)).toBe(true);
  expect(body.style.getPropertyValue('background-color')).toBe('');
  store.restoreAll();
  expect(body.style.getPropertyValue('background-color')).toBe('rgb(255, 204, 0)');
  expect(body.style.getPropertyPriority('background-color')).toBe(priority);
});

it('preserves the page color the document was served with', () => {
  const { store, ad, body } = fixture('rgb(17, 17, 17)');
  expect(store.apply(ad, 0.99, 0.9, false)).toBe(true);
  expect(body.style.getPropertyValue('background-color')).toBe('rgb(17, 17, 17)');
});

it('requires advertisement evidence before touching the page color', () => {
  const { store, ad, body } = fixture();
  evidence.advertisement = false;
  store.apply(ad, 0.99, 0.9, false);
  expect(body.style.getPropertyValue('background-color')).toBe('rgb(2, 74, 216)');
});

it('does not overwrite a later page-owned color change during mutation restoration', () => {
  const { store, ad, body } = fixture();
  store.apply(ad, 0.99, 0.9, false);
  body.style.setProperty('background-color', 'rgb(19, 19, 19)');
  store.queueChanges([body]);
  expect(store.restoreNext()?.restored).toBe(true);
  expect(body.style.getPropertyValue('background-color')).toBe('rgb(19, 19, 19)');
  expect(body.style.getPropertyPriority('background-color')).toBe('');
});

it('removes and restores the same-element color of a classified background image', () => {
  const { store, body } = fixture();
  body.style.setProperty('background-image', 'url("creative.png")');
  expect(store.apply(body, 0.99, 0.9, false, 'background')).toBe(true);
  expect(body.style.getPropertyValue('background-image')).toBe('none');
  expect(body.style.getPropertyValue('background-color')).toBe('');
  store.restoreAll();
  expect(body.style.getPropertyValue('background-image')).toBe('url("creative.png")');
  expect(body.style.getPropertyPriority('background-image')).toBe('');
  expect(body.style.getPropertyValue('background-color')).toBe('rgb(2, 74, 216)');
});

it('leaves colors untouched in debug mode and for below-threshold results', () => {
  const { store, ad, body } = fixture();
  expect(store.apply(ad, 0.8, 0.9, false)).toBe(false);
  expect(body.style.getPropertyValue('background-color')).toBe('rgb(2, 74, 216)');
  expect(store.apply(ad, 0.99, 0.9, true)).toBe(false);
  expect(body.style.getPropertyValue('background-color')).toBe('rgb(2, 74, 216)');
});

it('neutralizes an ad-owned page-background variable and restores it when revealing the ad', () => {
  const { store, ad, wrapper, body } = fixture();
  body.style.removeProperty('background-color');
  class BackgroundRule {
    readonly selectorText = 'body';
    readonly style = {
      *[Symbol.iterator]() {
        yield '--site-background';
      },
      getPropertyValue: () => '#024ad8',
    };
  }
  vi.stubGlobal('CSSStyleRule', BackgroundRule);
  const stylesheet = { parentElement: wrapper, sheet: { cssRules: [new BackgroundRule()] } };
  Object.defineProperty(wrapper, 'querySelectorAll', { value: () => [stylesheet] });
  Object.defineProperty(body.ownerDocument, 'defaultView', {
    value: {
      getComputedStyle: () => ({
        backgroundColor: 'rgb(2, 74, 216)',
        getPropertyValue: () => '#024ad8',
      }),
    },
  });
  expect(store.apply(ad, 0.99, 0.9, false)).toBe(true);
  expect(body.style.getPropertyValue('--site-background')).toBe('inherit');
  expect(body.style.getPropertyPriority('--site-background')).toBe('important');
  store.queueChanges([wrapper]);
  expect(store.restoreNext()?.restored).toBe(false);
  store.restoreAll();
  expect(body.style.getPropertyValue('--site-background')).toBe('');
  wrapper.style.setProperty('background-color', 'rgb(10, 10, 10)', 'important');
  store.apply(ad, 0.99, 0.9, false);
  expect(body.style.getPropertyValue('--site-background')).toBe('');
  wrapper.style.setProperty('background-color', 'rgb(2, 74, 216)', 'important');
  store.queueChanges([wrapper]);
  expect(store.restoreNext()?.restored).toBe(false);
  expect(body.style.getPropertyValue('--site-background')).toBe('inherit');
  store.restoreAll();
  expect(body.style.getPropertyValue('--site-background')).toBe('');
});

it('cleans a matching body color written after hiding and reapplied by the ad script', () => {
  const { store, ad, wrapper, body } = fixture();
  body.style.removeProperty('background-color');
  expect(store.apply(ad, 0.99, 0.9, false)).toBe(true);
  for (let write = 0; write < 2; write++) {
    body.style.setProperty('background-color', 'rgb(2, 74, 216)', 'important');
    store.queueChanges([body]);
    expect(store.restoreNext()?.restored).toBe(false);
    expect(body.style.getPropertyValue('background-color')).toBe('');
    expect(wrapper.style.getPropertyValue('display')).toBe('none');
  }
  store.restoreAll();
  expect(body.style.getPropertyValue('background-color')).toBe('rgb(2, 74, 216)');
  expect(body.style.getPropertyPriority('background-color')).toBe('important');
});
