import { afterEach, expect, it, vi } from 'vitest';
import { extractCandidate } from '../lib/candidates/extract';

const state = vi.hoisted(() => ({ private: false, visible: true }));
vi.mock('../lib/candidates/regions', () => ({
  extractSpecialCandidate: () => null,
  hasOverlayAncestor: () => false,
}));
vi.mock('../lib/candidates/visibility', () => ({
  hasPrivateAncestor: () => state.private,
  isVisible: () => state.visible,
}));
vi.mock('../lib/candidates/features', () => ({
  CARD_CONTAINERS: 'article,aside,li',
  metadataLabels: () => [],
  generatedAdLabel: () => '',
  collectFeatures: () => ({
    text: 'International lesen, einmal zahlen. Ab 1 € testen.',
    labels: [],
    linkHosts: ['service.example.org'],
    display: {
      position: 'fixed',
      frames: 0,
      images: 0,
      backgroundImage: false,
      labelOnly: false,
      fullViewport: false,
    },
  }),
}));

class BannerElement {
  readonly tagName = 'DIV';
  readonly childNodes = [];
  readonly ownerDocument = {
    defaultView: { getComputedStyle: () => ({ position: this.position }) },
    getSelection: () => null,
  };
  constructor(readonly position: string) {}
  matches(selector: string): boolean {
    return selector.split(',').includes('div');
  }
}

function candidate(position: string): unknown {
  vi.stubGlobal('Element', BannerElement);
  const element: unknown = new BannerElement(position);
  if (!(element instanceof Element)) throw new Error('Expected banner fixture');
  return extractCandidate(element, 'banner', 'news.example.org');
}

afterEach(() => {
  state.private = false;
  state.visible = true;
  vi.unstubAllGlobals();
});

it.each(['fixed', 'sticky'])(
  'extracts nested %s banners without direct text children',
  (position) => {
    expect(candidate(position)).toHaveProperty(
      'text',
      'International lesen, einmal zahlen. Ab 1 € testen.',
    );
  },
);

it('does not promote ordinary layout wrappers to candidates', () => {
  expect(candidate('static')).toBeNull();
});

it('keeps private banners excluded', () => {
  state.private = true;
  expect(candidate('fixed')).toBeNull();
});

it('keeps invisible banners excluded', () => {
  state.visible = false;
  expect(candidate('fixed')).toBeNull();
});
