import { afterEach, expect, it, vi } from 'vitest';
import { PresentationStore } from '../lib/blocking/hide';

const boundaries = vi.hoisted(() => ({ valid: true, promote: true }));
vi.mock('../lib/blocking/ad-container', () => ({
  findAdContainer: (element: { readonly parentElement: unknown }) =>
    boundaries.promote ? element.parentElement : element,
  isAdContainer: () => boundaries.valid,
}));
vi.mock('../lib/candidates/visibility', () => ({ isSafeCandidateBoundary: () => true }));
vi.mock('../lib/candidates/fingerprint', () => ({ presentationFingerprint: () => 'unchanged ad' }));

class FixtureElement {
  isConnected = true;
  parentElement: FixtureElement | null = null;
  readonly ownerDocument = {};
  readonly values = new Map<string, { readonly value: string; readonly priority: string }>();
  readonly style = {
    getPropertyValue: (name: string): string => this.values.get(name)?.value ?? '',
    getPropertyPriority: (name: string): string => this.values.get(name)?.priority ?? '',
    setProperty: (name: string, value: string, priority = ''): void => {
      this.values.set(name, { value, priority });
    },
    removeProperty: (name: string): void => {
      this.values.delete(name);
    },
  };
  matches(): boolean {
    return false;
  }
  querySelector(): null {
    return null;
  }
  contains(node: unknown): boolean {
    return node === this || (node instanceof FixtureElement && node.parentElement === this);
  }
}

function domElement(value: unknown): HTMLElement {
  if (!(value instanceof HTMLElement)) throw new Error('Expected fixture element');
  return value;
}

function fixture(): {
  readonly store: PresentationStore;
  readonly ad: HTMLElement;
  readonly wrapper: HTMLElement;
  readonly sibling: HTMLElement;
} {
  vi.stubGlobal('HTMLElement', FixtureElement);
  boundaries.valid = true;
  boundaries.promote = true;
  const wrapper = new FixtureElement();
  const ad = new FixtureElement();
  const sibling = new FixtureElement();
  ad.parentElement = wrapper;
  sibling.parentElement = wrapper;
  return {
    store: new PresentationStore(),
    ad: domElement(ad),
    wrapper: domElement(wrapper),
    sibling: domElement(sibling),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it('hides the surrounding slot once and restores its original display style', () => {
  const { store, ad, wrapper } = fixture();
  wrapper.style.setProperty('display', 'grid');
  expect(store.apply(ad, 0.99, 0.9, false)).toBe(true);
  expect(store.target(ad)).toBe(wrapper);
  expect(wrapper.style.getPropertyValue('display')).toBe('none');
  expect(ad.style.getPropertyValue('display')).toBe('');
  expect(store.restoreAll()).toBe(1);
  expect(wrapper.style.getPropertyValue('display')).toBe('grid');
  expect(wrapper.style.getPropertyPriority('display')).toBe('');
});

it('restores and rescans the wrapper when a sibling gains meaningful content', () => {
  const { store, ad, wrapper, sibling } = fixture();
  store.apply(ad, 0.99, 0.9, false);
  boundaries.valid = false;
  store.queueChanges([sibling]);
  expect(store.restoreNext()).toEqual({
    restored: true,
    retargeted: false,
    root: wrapper,
    element: ad,
  });
  expect(wrapper.style.getPropertyValue('display')).toBe('');
});

it('moves the hide onto the slot wrapper once the placement finishes', () => {
  const { store, ad, wrapper } = fixture();
  boundaries.promote = false;
  store.apply(ad, 0.99, 0.9, false);
  expect(ad.style.getPropertyValue('display')).toBe('none');
  boundaries.promote = true;
  store.queueChanges([ad]);
  expect(store.restoreNext()).toEqual({
    restored: false,
    retargeted: true,
    root: null,
    element: ad,
  });
  expect(wrapper.style.getPropertyValue('display')).toBe('none');
  expect(ad.style.getPropertyValue('display')).toBe('');
  expect(store.restoreAll()).toBe(1);
  expect(wrapper.style.getPropertyValue('display')).toBe('');
});

it('preserves a display change made by the page after hiding', () => {
  const { store, ad, wrapper } = fixture();
  store.apply(ad, 0.99, 0.9, false);
  wrapper.style.setProperty('display', 'flex', 'important');
  store.queueChanges([wrapper]);
  expect(store.restoreNext()?.restored).toBe(true);
  expect(wrapper.style.getPropertyValue('display')).toBe('flex');
});

it('debug mode outlines only the candidate without collapsing the wrapper', () => {
  const { store, ad, wrapper } = fixture();
  expect(store.apply(ad, 0.99, 0.9, true)).toBe(false);
  expect(store.target(ad)).toBe(ad);
  expect(ad.style.getPropertyValue('outline')).toContain('solid');
  expect(wrapper.style.getPropertyValue('display')).toBe('');
});
