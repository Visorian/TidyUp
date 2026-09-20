import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { adSlotFingerprint, findAdSlot } from '../lib/blocking/ad-slot';
import { PresentationStore } from '../lib/blocking/hide';

vi.mock('../lib/blocking/ad-container', () => ({
  findAdContainer: (node: HTMLElement) => node,
  isAdContainer: () => true,
}));
vi.mock('../lib/blocking/background-color', () => ({
  adBackgroundColorTarget: () => null,
  adBackgroundVariables: () => [],
}));

class FixtureElement {
  readonly tagName = 'DIV';
  id = '';
  isConnected = true;
  parentElement: FixtureElement | null = null;
  readonly assignedSlot = null;
  readonly shadowRoot = null;
  readonly children: FixtureElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly styles = new Map<string, string>();
  readonly style = {
    getPropertyValue: (name: string): string => this.styles.get(name) ?? '',
    getPropertyPriority: (): string => 'important',
    setProperty: (name: string, value: string): void => {
      this.styles.set(name, value);
    },
    removeProperty: (name: string): void => {
      this.styles.delete(name);
    },
  };
  readonly ownerDocument = {
    createTreeWalker: (): { nextNode: () => FixtureElement | null } => {
      const pending = [...this.children];
      return {
        nextNode: () => {
          const node = pending.shift();
          if (node !== undefined) pending.unshift(...node.children);
          return node ?? null;
        },
      };
    },
  };
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return name === 'id' ? this.id : (this.attributes.get(name) ?? null);
  }
  matches(selectors: string): boolean {
    return selectors
      .split(',')
      .some(
        (selector) =>
          selector === this.tagName.toLowerCase() ||
          (selector === '[contenteditable]' && this.attributes.has('contenteditable')),
      );
  }
  querySelector(selectors: string): FixtureElement | null {
    for (const child of this.children) {
      if (child.matches(selectors)) return child;
      const match = child.querySelector(selectors);
      if (match !== null) return match;
    }
    return null;
  }
  contains(node: unknown): boolean {
    return (
      node === this ||
      this.children.some((child: { readonly contains: (value: unknown) => boolean }) =>
        child.contains(node),
      )
    );
  }
  getRootNode(): object {
    return this.ownerDocument;
  }
}

function element(tag = 'div', parent?: HTMLElement): HTMLElement {
  const node = new FixtureElement();
  Object.defineProperty(node, 'tagName', { value: tag.toUpperCase() });
  if (parent instanceof FixtureElement) {
    node.parentElement = parent;
    parent.children.push(node);
  }
  if (!(node instanceof HTMLElement)) throw new Error('Missing DOM fixture');
  return node;
}

beforeEach(() => {
  vi.stubGlobal('Element', FixtureElement);
  vi.stubGlobal('HTMLElement', FixtureElement);
  vi.stubGlobal('HTMLSlotElement', Date);
  vi.stubGlobal('ShadowRoot', Date);
  vi.stubGlobal('NodeFilter', { SHOW_ELEMENT: 1 });
});
afterEach(() => vi.unstubAllGlobals());

function slot(parent?: HTMLElement): HTMLElement {
  const node = element('div', parent);
  if (node instanceof FixtureElement) node.attributes.set('class', 'go-ad-slot__wrapper loading');
  return node;
}

it('remembers the closest identified slot inside the validated presentation boundary', () => {
  const wrapper = slot();
  const inner = slot(wrapper);
  inner.id = 'iqadtile8';
  const creative = element('iframe', inner);
  expect(findAdSlot(creative, wrapper)).toBe(inner);
  expect(findAdSlot(creative, element())).toBeNull();
  expect(adSlotFingerprint(element())).toBeNull();
});

it('keeps one slot identity across creative states and generated identifiers', () => {
  const before = element();
  const after = element();
  const teaser = element();
  before.id = 'adCont_7687366005231715545';
  before.setAttribute('class', 'Ad-Slot Ad-Slot-desktop');
  after.id = 'adCont_2231908877665';
  after.setAttribute('class', 'Ad-Slot Ad-Slot-desktop Ad-Slot--filled');
  teaser.setAttribute('class', 'teaser-card');
  expect(adSlotFingerprint(before)).toBe(adSlotFingerprint(after));
  expect(adSlotFingerprint(teaser)).toBeNull();
});

it('keeps a learned empty slot hidden while its creative loads and restores it on request', () => {
  const node = slot();
  const store = new PresentationStore();
  expect(store.apply(node, 0.99, 0.9, false, 'ad-slot')).toBe(true);
  element('iframe', node);
  element('a', node);
  node.setAttribute('class', 'loaded go-ad-slot__wrapper go-ad-slot--filled');
  store.queueChanges([node]);
  expect(store.restoreNext()?.restored).toBe(false);
  expect(node.style.getPropertyValue('display')).toBe('none');
  expect(store.restoreAll()).toBe(1);
  expect(node.style.getPropertyValue('display')).toBe('');
});

it('keeps a slot hidden on its first decision while the creative arrives', () => {
  const node = slot();
  const store = new PresentationStore();
  expect(store.apply(node, 0.99, 0.9, false)).toBe(true);
  element('iframe', node);
  node.setAttribute('class', 'go-ad-slot__wrapper loaded go-ad-slot--filled');
  store.queueChanges([node]);
  expect(store.restoreNext()?.restored).toBe(false);
  expect(node.style.getPropertyValue('display')).toBe('none');
});

it.each(['article', 'h2', 'input', 'button'])(
  'restores a slot repurposed for %s content',
  (tag) => {
    const node = slot();
    const store = new PresentationStore();
    expect(store.apply(node, 0.99, 0.9, false, 'ad-slot')).toBe(true);
    element(tag, node);
    store.queueChanges([node]);
    expect(store.restoreNext()?.restored).toBe(true);
    expect(node.style.getPropertyValue('display')).toBe('');
    expect(store.apply(node, 0.99, 0.9, false, 'ad-slot')).toBe(false);
  },
);
