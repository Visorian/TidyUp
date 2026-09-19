/* oxlint-disable eslint/max-classes-per-file -- Minimal DOM and presentation doubles keep the real scheduler and queue under test. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../lib/config/defaults';
import { PageSession } from '../lib/runtime/page-session';
import type { AdCandidate, ExtensionMessage } from '../lib/shared/types';

const runtime = vi.hoisted(() => ({
  listeners: new Set<
    (message: unknown, sender: unknown, respond: (response: unknown) => void) => void
  >(),
  sendMessage: vi.fn<(message: ExtensionMessage) => Promise<unknown>>(),
  invalidText: new Set<string>(),
  applied: vi.fn<(element: unknown) => boolean>(() => false),
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
    readonly hasPending = false;
    readonly apply = runtime.applied;
    has(): boolean {
      return false;
    }
    restoreAll(): number {
      return 0;
    }
    restoreNext(): undefined {
      return undefined;
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
  runtime.applied.mockClear();
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
      constructor(callback: typeof mutate) {
        mutate = callback;
      }
      observe(): void {}
      disconnect(): void {}
    },
  );
  runtime.sendMessage.mockImplementation((message) => {
    if (message.type === 'GET_SETTINGS')
      return Promise.resolve({
        ok: true,
        configured: true,
        settings: { ...DEFAULT_SETTINGS, rules: ['Hide paid advertising.'] },
      });
    if (message.type !== 'CLASSIFY') throw new Error('Unexpected message');
    classified.push(...message.candidates.map((candidate) => candidate.text));
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          ok: true,
          results: message.candidates.map(({ id }) => ({ id, probability: 0.99 })),
        });
      }, 1000);
    });
  });
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
  expect(status()).toMatchObject({ metrics: { queued: 64 } });
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
