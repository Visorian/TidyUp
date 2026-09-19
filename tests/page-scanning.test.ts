/* oxlint-disable eslint/max-classes-per-file, eslint/max-lines -- Minimal DOM and presentation doubles keep the real scheduler and queue under test. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../lib/config/defaults';
import { PageSession } from '../lib/runtime/page-session';
import type { AdCandidate, ExtensionMessage, Settings } from '../lib/shared/types';

const runtime = vi.hoisted(() => ({
  listeners: new Set<
    (message: unknown, sender: unknown, respond: (response: unknown) => void) => void
  >(),
  sendMessage: vi.fn<(message: ExtensionMessage) => Promise<unknown>>(),
  invalidText: new Set<string>(),
  applied: vi.fn<(element: unknown) => boolean>(() => false),
  restorations: [] as {
    readonly element: unknown;
    readonly root: null;
    readonly restored: boolean;
  }[],
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage: runtime.sendMessage,
      onMessage: {
        addListener: runtime.listeners.add.bind(runtime.listeners),
        removeListener: runtime.listeners.delete.bind(runtime.listeners),
      },
    },
  },
}));

vi.mock('../lib/candidates/extract', () => ({
  enumerateElements: function* (root: { readonly children: readonly unknown[] }) {
    yield* root.children;
  },
  extractCandidate: (
    element: { readonly textContent: string },
    id: string,
    pageHost: string,
  ): AdCandidate | null =>
    runtime.invalidText.has(element.textContent)
      ? null
      : {
          id,
          pageHost,
          tag: 'div',
          text: element.textContent,
          labels: ['advertisement'],
          linkHosts: [],
        },
}));

vi.mock('../lib/blocking/hide', () => ({
  PresentationStore: class {
    private readonly elements = new Set<unknown>();
    get hasPending(): boolean {
      return runtime.restorations.length > 0;
    }
    apply(element: unknown): boolean {
      const hidden = runtime.applied(element);
      if (hidden) this.elements.add(element);
      return hidden;
    }
    has(element: unknown): boolean {
      return this.elements.has(element);
    }
    target(element: Element): Element {
      return element;
    }
    restoreAll(): number {
      const count = this.elements.size;
      this.elements.clear();
      return count;
    }
    restoreNext(): (typeof runtime.restorations)[number] | undefined {
      const change = runtime.restorations.shift();
      if (change?.restored === true) this.elements.delete(change.element);
      return change;
    }
    queueChanges(): void {}
  },
  watchPresentation: vi.fn<() => void>(),
}));

class TestElement extends EventTarget {
  readonly isConnected = true;
  readonly shadowRoot = null;
  constructor(
    readonly textContent: string,
    readonly children: readonly Readonly<TestElement>[] = [],
  ) {
    super();
  }

  contains(other: unknown): boolean {
    return other === this || (other instanceof TestElement && this.children.includes(other));
  }
}

class TestDocument extends TestElement {
  readonly visibilityState = 'visible';
}

let session: PageSession | undefined;
let document: TestDocument;
let documentElements: TestElement[];
let mutate: (records: readonly { readonly target: Readonly<TestElement> }[]) => void;
let classified: string[];
let settings: Settings;
let ruleProbabilities: readonly number[];

function status(): unknown {
  let response: unknown;
  const respond = (value: unknown): void => {
    response = value;
  };
  for (const listener of runtime.listeners) listener({ type: 'GET_STATUS' }, {}, respond);
  return response;
}

beforeEach(() => {
  vi.useFakeTimers();
  runtime.listeners.clear();
  runtime.sendMessage.mockReset();
  runtime.applied.mockReset().mockReturnValue(false);
  runtime.restorations.length = 0;
  settings = { ...DEFAULT_SETTINGS, rules: ['Hide paid advertising.'] };
  ruleProbabilities = [0.99];
  runtime.invalidText.clear();
  classified = [];
  documentElements = [];
  document = new TestDocument('', documentElements);
  vi.stubGlobal('location', new URL('https://news.example.org/'));
  vi.stubGlobal('document', document);
  vi.stubGlobal('Element', TestElement);
  vi.stubGlobal('Document', TestDocument);
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    }),
  );
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(private readonly callback: typeof mutate) {}
      observe(): void {
        mutate = this.callback;
      }
      disconnect(): void {}
    },
  );
  runtime.sendMessage.mockImplementation(respondToMessage);
});

afterEach(() => {
  session?.stop();
  session = undefined;
  vi.useRealTimers();
});

function appendCandidates(count: number, prefix: string): TestElement[] {
  const elements = Array.from(
    { length: count },
    (_, index) => new TestElement(`${prefix} ${index}`),
  );
  documentElements.push(...elements);
  return elements;
}

it('eventually classifies every candidate on a large page while provider responses are delayed', async () => {
  const elements = appendCandidates(180, 'Initial advertisement');
  session = new PageSession();
  session.start();
  await vi.advanceTimersByTimeAsync(900);
  expect(classified.length).toBeGreaterThan(0);
  expect(classified.length).toBeLessThan(elements.length);
  expect(runtime.applied).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(20_000);
  expect(classified.toSorted()).toEqual(
    elements.map((element: Readonly<TestElement>) => element.textContent).toSorted(),
  );
  expect(runtime.applied).toHaveBeenCalledTimes(elements.length);
  expect(status()).toMatchObject({ error: '', metrics: { dropped: 0, queued: 0 } });
});

it('retains newly inserted candidates while a full scan is waiting for provider capacity', async () => {
  const initial = appendCandidates(150, 'Initial advertisement');
  session = new PageSession();
  session.start();
  await vi.advanceTimersByTimeAsync(900);
  const inserted = appendCandidates(80, 'Inserted advertisement');
  mutate([{ target: document }]);

  await vi.advanceTimersByTimeAsync(25_000);
  const expected = [...initial, ...inserted];
  expect(classified.toSorted()).toEqual(
    expected.map((element: Readonly<TestElement>) => element.textContent).toSorted(),
  );
  expect(runtime.applied).toHaveBeenCalledTimes(expected.length);
  expect(status()).toMatchObject({ error: '', metrics: { dropped: 0, queued: 0 } });
});

it('resumes the remaining scan when queued candidates all become invalid before classification', async () => {
  const elements = appendCandidates(100, 'Advertisement');
  session = new PageSession();
  session.start();
  await vi.advanceTimersByTimeAsync(390);
  expect(status()).toMatchObject({ metrics: { queued: 100 } });
  for (const element of elements.slice(0, 64)) runtime.invalidText.add(element.textContent);

  await vi.advanceTimersByTimeAsync(10_000);
  expect(classified.toSorted()).toEqual(
    elements
      .slice(64)
      .map((element: Readonly<TestElement>) => element.textContent)
      .toSorted(),
  );
  expect(runtime.applied).toHaveBeenCalledTimes(36);
  expect(status()).toMatchObject({ error: '', metrics: { dropped: 0, queued: 0 } });
});

function control(type: 'REVEAL' | 'HIDE_AGAIN' | 'RESCAN' | 'SETTINGS_CHANGED'): void {
  for (const listener of runtime.listeners) listener({ type }, {}, () => {});
}

it('hides a multi-category match once, counts each category once, and clears counts on reveal', async () => {
  settings = {
    ...DEFAULT_SETTINGS,
    categories: [
      { id: 'ads', name: 'Ads', enabled: true, rules: ['Hide banners.', 'Hide sponsors.'] },
      { id: 'cookies', name: 'Cookies', enabled: true, rules: ['Hide consent overlays.'] },
      {
        id: 'subscriptions',
        name: 'Subscriptions',
        enabled: false,
        rules: ['Hide subscriptions.'],
      },
    ],
  };
  ruleProbabilities = [0.99, 0.98, 0.95];
  runtime.applied.mockReturnValue(true);
  appendCandidates(1, 'Sponsored consent region');
  session = new PageSession();
  session.start();
  await vi.advanceTimersByTimeAsync(3000);
  expect(runtime.applied).toHaveBeenCalledOnce();
  expect(status()).toMatchObject({
    metrics: { hidden: 1 },
    hiddenByCategory: { ads: 1, cookies: 1 },
  });
  control('REVEAL');
  expect(status()).toMatchObject({ metrics: { hidden: 0 }, hiddenByCategory: {}, paused: true });
});

it('removes category counts when a hidden region is detached and restored', async () => {
  settings = {
    ...DEFAULT_SETTINGS,
    categories: [{ id: 'ads', name: 'Ads', enabled: true, rules: ['Hide banners.'] }],
  };
  runtime.applied.mockReturnValue(true);
  const [element] = appendCandidates(1, 'Advertisement');
  const candidate = requireElement(element);
  session = new PageSession();
  session.start();
  await vi.advanceTimersByTimeAsync(3000);
  expect(status()).toMatchObject({ hiddenByCategory: { ads: 1 } });
  runtime.invalidText.add(candidate.textContent);
  runtime.restorations.push({ restored: true, element: candidate, root: null });
  mutate([{ target: document }]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(status()).toMatchObject({ metrics: { hidden: 0, restored: 1 }, hiddenByCategory: {} });
});

it('restores a category and stops classification when its last enabled rule is switched off', async () => {
  const category = { id: 'ads', name: 'Ads', enabled: true, rules: ['Hide banners.'] };
  settings = { ...DEFAULT_SETTINGS, categories: [category] };
  runtime.applied.mockReturnValue(true);
  appendCandidates(1, 'Advertisement');
  session = new PageSession();
  session.start();
  await vi.advanceTimersByTimeAsync(3000);
  expect(status()).toMatchObject({ hiddenByCategory: { ads: 1 } });
  settings = { ...settings, categories: [{ ...category, enabled: false }] };
  control('SETTINGS_CHANGED');
  await vi.advanceTimersByTimeAsync(3000);
  expect(status()).toMatchObject({
    enabled: false,
    metrics: { hidden: 0, restored: 1 },
    hiddenByCategory: {},
  });
  expect(classified).toHaveLength(1);
});

function respondToMessage(message: ExtensionMessage): Promise<unknown> {
  if (message.type === 'GET_SETTINGS')
    return Promise.resolve({
      ok: true,
      configured: true,
      settings,
    });
  if (message.type === 'LOOKUP_CACHE') return Promise.resolve({ ok: true, results: [] });
  if (message.type === 'GET_REPLAY') return Promise.resolve({ ok: true, snapshot: null });
  if (message.type !== 'CLASSIFY') throw new Error('Unexpected message');
  classified.push(...message.candidates.map((candidate) => candidate.text));
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        ok: true,
        results: message.candidates.map(({ id }) => ({
          id,
          probability: Math.max(...ruleProbabilities),
          ruleProbabilities,
        })),
      });
    }, 1000);
  });
}

function requireElement(value: Readonly<TestElement> | undefined): Readonly<TestElement> {
  if (value === undefined) throw new Error('Missing candidate');
  return value;
}

it('rehides unchanged regions promptly without classification when caching is disabled', async () => {
  settings = {
    ...DEFAULT_SETTINGS,
    cacheEnabled: false,
    categories: [
      { id: 'ads', name: 'Ads', enabled: true, rules: ['Hide ads.'] },
      { id: 'subscriptions', name: 'Subscriptions', enabled: true, rules: ['Hide subscriptions.'] },
    ],
  };
  ruleProbabilities = [0.99, 0.95];
  runtime.applied.mockReturnValue(true);
  appendCandidates(3, 'Advertisement');
  session = new PageSession();
  session.start();
  await vi.advanceTimersByTimeAsync(3000);
  expect(classified).toHaveLength(3);
  control('REVEAL');
  expect(status()).toMatchObject({ paused: true, metrics: { hidden: 0 }, hiddenByCategory: {} });
  control('HIDE_AGAIN');
  await vi.advanceTimersByTimeAsync(100);
  expect(status()).toMatchObject({
    paused: false,
    metrics: { hidden: 3 },
    hiddenByCategory: { ads: 3, subscriptions: 3 },
  });
  expect(runtime.applied).toHaveBeenCalledTimes(6);
  await vi.advanceTimersByTimeAsync(3000);
  expect(classified).toHaveLength(3);
  control('REVEAL');
  control('REVEAL');
  control('HIDE_AGAIN');
  await vi.advanceTimersByTimeAsync(100);
  expect(status()).toMatchObject({ metrics: { hidden: 3 } });
  expect(classified).toHaveLength(3);
});

it('reevaluates edited regions instead of replaying old hidden decisions', async () => {
  runtime.applied.mockReturnValue(true);
  const element = requireElement(appendCandidates(1, 'Advertisement')[0]);
  session = new PageSession();
  session.start();
  await vi.advanceTimersByTimeAsync(3000);
  control('REVEAL');
  Object.defineProperty(element, 'textContent', {
    value: 'Changed region requiring a new decision',
  });
  control('HIDE_AGAIN');
  await vi.advanceTimersByTimeAsync(100);
  expect(status()).toMatchObject({ paused: false, metrics: { hidden: 0 } });
  expect(runtime.applied).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(3000);
  expect(classified).toEqual(['Advertisement 0', 'Changed region requiring a new decision']);
});

it('discards revealed decisions after settings changes even if their regions are unchanged', async () => {
  runtime.applied.mockReturnValue(true);
  appendCandidates(1, 'Advertisement');
  session = new PageSession();
  session.start();
  await vi.advanceTimersByTimeAsync(3000);
  control('REVEAL');
  settings = { ...settings, rules: ['Hide subscriptions.'] };
  control('SETTINGS_CHANGED');
  await vi.advanceTimersByTimeAsync(1);
  control('HIDE_AGAIN');
  await vi.advanceTimersByTimeAsync(100);
  expect(status()).toMatchObject({ metrics: { hidden: 0 } });
  expect(runtime.applied).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(3000);
  expect(classified).toHaveLength(2);
});

it('discards revealed decisions on navigation and leaves manual activation waiting', async () => {
  settings = { ...settings, activation: 'manual' };
  runtime.applied.mockReturnValue(true);
  appendCandidates(1, 'Advertisement');
  session = new PageSession();
  session.start();
  await vi.advanceTimersByTimeAsync(1);
  control('RESCAN');
  await vi.advanceTimersByTimeAsync(3000);
  control('REVEAL');
  control('HIDE_AGAIN');
  await vi.advanceTimersByTimeAsync(100);
  expect(status()).toMatchObject({
    paused: false,
    waitingForActivation: false,
    metrics: { hidden: 1 },
  });
  control('REVEAL');
  vi.stubGlobal('location', new URL('https://news.example.org/next'));
  control('HIDE_AGAIN');
  await vi.advanceTimersByTimeAsync(3000);
  expect(status()).toMatchObject({
    paused: false,
    waitingForActivation: true,
    metrics: { hidden: 0 },
  });
  expect(classified).toHaveLength(1);
});

it('does not replay detached regions or reuse revealed decisions for an explicit rescan', async () => {
  runtime.applied.mockReturnValue(true);
  const element = requireElement(appendCandidates(1, 'Advertisement')[0]);
  session = new PageSession();
  session.start();
  await vi.advanceTimersByTimeAsync(3000);
  control('REVEAL');
  Object.defineProperty(element, 'isConnected', { value: false, configurable: true });
  control('HIDE_AGAIN');
  await vi.advanceTimersByTimeAsync(100);
  expect(status()).toMatchObject({ metrics: { hidden: 0 } });
  expect(runtime.applied).toHaveBeenCalledOnce();
  Object.defineProperty(element, 'isConnected', { value: true });
  control('REVEAL');
  control('RESCAN');
  await vi.advanceTimersByTimeAsync(100);
  expect(status()).toMatchObject({ metrics: { hidden: 0 } });
  await vi.advanceTimersByTimeAsync(3000);
  expect(classified).toHaveLength(2);
});

it('hides a newly inserted cached region before an earlier provider request completes', async () => {
  runtime.applied.mockReturnValue(true);
  runtime.sendMessage.mockImplementation(respondWithCachedAdvertisement);
  appendCandidates(1, 'Uncached advertisement');
  session = new PageSession();
  session.start();
  await vi.advanceTimersByTimeAsync(900);
  expect(classified).toEqual(['Uncached advertisement 0']);
  expect(runtime.applied).not.toHaveBeenCalled();
  const cached = requireElement(appendCandidates(1, 'Cached advertisement')[0]);
  mutate([{ target: document }]);
  await vi.advanceTimersByTimeAsync(300);
  expect(runtime.applied).toHaveBeenCalledExactlyOnceWith(cached);
  expect(classified).toEqual(['Uncached advertisement 0']);
  expect(status()).toMatchObject({ metrics: { hidden: 1, cacheHits: 1 } });
  await vi.advanceTimersByTimeAsync(2000);
  expect(runtime.applied).toHaveBeenCalledTimes(2);
  expect(classified).toEqual(['Uncached advertisement 0']);
});

function respondWithCachedAdvertisement(message: ExtensionMessage): Promise<unknown> {
  if (message.type === 'LOOKUP_CACHE')
    return Promise.resolve({
      ok: true,
      results: message.candidates
        .filter((candidate) => candidate.text.startsWith('Cached advertisement'))
        .map(({ id }) => ({ id, probability: 0.99, ruleProbabilities: [0.99] })),
    });
  return respondToMessage(message);
}

it('continues discovering and hiding cache hits after a provider failure while leaving misses paused', async () => {
  runtime.applied.mockReturnValue(true);
  runtime.sendMessage.mockImplementation(respondWithFailedProvider);
  appendCandidates(1, 'Uncached advertisement');
  session = new PageSession();
  session.start();
  await vi.advanceTimersByTimeAsync(2000);
  expect(classified).toEqual(['Uncached advertisement 0']);
  expect(status()).toMatchObject({ error: 'Provider unavailable', metrics: { hidden: 0 } });
  const cached = requireElement(appendCandidates(1, 'Cached advertisement')[0]);
  appendCandidates(1, 'Later uncached advertisement');
  mutate([{ target: document }]);
  await vi.advanceTimersByTimeAsync(300);
  expect(runtime.applied).toHaveBeenCalledExactlyOnceWith(cached);
  expect(status()).toMatchObject({
    error: 'Provider unavailable',
    metrics: { hidden: 1, cacheHits: 1, queued: 1 },
  });
  await vi.advanceTimersByTimeAsync(5000);
  expect(classified).toEqual(['Uncached advertisement 0']);
  expect(runtime.applied).toHaveBeenCalledOnce();
});

function respondWithFailedProvider(message: ExtensionMessage): Promise<unknown> {
  if (message.type === 'CLASSIFY') {
    classified.push(...message.candidates.map((candidate) => candidate.text));
    return Promise.resolve({ ok: false, error: 'Provider unavailable' });
  }
  return respondWithCachedAdvertisement(message);
}
