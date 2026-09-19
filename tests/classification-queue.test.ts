import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../lib/config/defaults';
import { ClassificationQueue, type PendingCandidate } from '../lib/runtime/classification-queue';
import type { CandidateClassification, ExtensionMessage } from '../lib/shared/types';

const sendMessage = vi.hoisted(() => vi.fn<(message: ExtensionMessage) => Promise<unknown>>());
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage } } }));

interface Request {
  readonly message: Extract<ExtensionMessage, { readonly type: 'CLASSIFY' }>;
  readonly resolve: (response: unknown) => void;
}

const requests: Request[] = [];
let queue: ClassificationQueue;
let generation: number;
let cacheEnabled: boolean;
const apply =
  vi.fn<(pending: Readonly<PendingCandidate>, result: CandidateClassification) => void>();
const failures = vi.fn<(message: string) => void>();

class FixtureElement {
  contains(): boolean {
    return false;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  });
  vi.stubGlobal('HTMLElement', FixtureElement);
  vi.stubGlobal('location', { hostname: 'news.example.org' });
  requests.length = 0;
  generation = 0;
  cacheEnabled = true;
  apply.mockClear();
  failures.mockClear();
  sendMessage.mockReset().mockImplementation((message) => {
    if (message.type !== 'CLASSIFY') throw new Error('Unexpected message');
    const deferred = Promise.withResolvers<unknown>();
    requests.push({ message, resolve: deferred.resolve });
    return deferred.promise;
  });
  queue = new ClassificationQueue({
    runnable: () => !queue.suspended,
    cacheEnabled: () => cacheEnabled,
    ruleCount: () => 1,
    settings: () => ({ ...DEFAULT_SETTINGS, rules: ['Hide advertising.'] }),
    current: (entry) => entry.generation === generation,
    apply,
    wake: () => {},
    fail: (message) => {
      failures(message);
      queue.suspended = true;
      queue.cancel();
      queue.clear();
    },
    generation: () => generation,
    checkNavigation: () => false,
  });
});
afterEach(() => {
  queue.reset();
  vi.useRealTimers();
});

function pending(id: string, fingerprint = id): PendingCandidate {
  return {
    element: new HTMLElement(),
    fingerprint,
    generation,
    candidate: {
      id,
      tag: 'div',
      text: id,
      labels: ['advertisement'],
      linkHosts: [],
      pageHost: 'news.example.org',
    },
  };
}

function request(index: number): Request {
  const item = requests[index];
  if (item === undefined) throw new Error('Missing request');
  return item;
}

function succeed(index: number): void {
  const item = request(index);
  item.resolve({
    ok: true,
    results: item.message.candidates.map(({ id }) => ({
      id,
      probability: 0.99,
      ruleProbabilities: [0.99],
    })),
  });
}

function fail(index: number): void {
  request(index).resolve({ ok: false, error: 'Temporarily unavailable', retryAfterMs: 1000 });
}

it('gathers the first batch, then drains existing backlog after idle preparation without another 100 ms wait', async () => {
  for (let index = 0; index < 40; index++) queue.add(pending(`ad-${index}`));
  queue.schedule();
  await vi.advanceTimersByTimeAsync(99);
  expect(sendMessage).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(17);
  expect(requests).toHaveLength(1);
  expect(request(0).message.candidates).toHaveLength(32);
  await vi.advanceTimersByTimeAsync(500);
  expect(requests).toHaveLength(1);
  succeed(0);
  await vi.advanceTimersByTimeAsync(20);
  expect(requests).toHaveLength(2);
  expect(request(1).message.candidates).toHaveLength(8);
});

it('keeps the gathering delay for new work after the queue has become idle', async () => {
  queue.add(pending('first'));
  queue.schedule();
  await vi.advanceTimersByTimeAsync(116);
  succeed(0);
  await vi.advanceTimersByTimeAsync(20);
  queue.add(pending('later'));
  queue.schedule();
  await vi.advanceTimersByTimeAsync(99);
  expect(requests).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(17);
  expect(requests).toHaveLength(2);
});

it.each([
  { enabled: true, expectedRequests: 1, expectedCacheHits: 1, expectedApplied: 2 },
  { enabled: false, expectedRequests: 2, expectedCacheHits: 0, expectedApplied: 1 },
])(
  'rechecks cache at dispatch and respects caching=$enabled',
  async ({
    enabled,
    expectedRequests,
    expectedCacheHits,
    expectedApplied,
  }: Readonly<{
    enabled: boolean;
    expectedRequests: number;
    expectedCacheHits: number;
    expectedApplied: number;
  }>) => {
    cacheEnabled = enabled;
    queue.add(pending('first', 'same-content'));
    queue.schedule();
    await vi.advanceTimersByTimeAsync(116);
    queue.add(pending('second', 'same-content'));
    succeed(0);
    await vi.advanceTimersByTimeAsync(20);
    expect(requests).toHaveLength(expectedRequests);
    expect(queue.metrics.cacheHits).toBe(expectedCacheHits);
    expect(queue.applyNext()).toBe(true);
    expect(queue.applyNext()).toBe(enabled);
    expect(apply).toHaveBeenCalledTimes(expectedApplied);
  },
);

it('discards a response from before reset and gathers the new generation independently', async () => {
  queue.add(pending('old'));
  queue.schedule();
  await vi.advanceTimersByTimeAsync(116);
  generation++;
  queue.reset();
  queue.add(pending('new'));
  queue.schedule();
  await vi.advanceTimersByTimeAsync(500);
  expect(requests).toHaveLength(1);
  succeed(0);
  await vi.advanceTimersByTimeAsync(99);
  expect(requests).toHaveLength(1);
  expect(queue.hasDecisions).toBe(false);
  await vi.advanceTimersByTimeAsync(17);
  expect(request(1).message.candidates.map(({ id }) => id)).toEqual(['new']);
});

it('honors cooldown and the two-retry limit when backlog scheduling is immediate', async () => {
  queue.add(pending('ad'));
  queue.schedule();
  await vi.advanceTimersByTimeAsync(116);
  fail(0);
  await vi.advanceTimersByTimeAsync(999);
  expect(requests).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(20);
  expect(requests).toHaveLength(2);
  fail(1);
  await vi.advanceTimersByTimeAsync(1019);
  expect(requests).toHaveLength(3);
  fail(2);
  await vi.advanceTimersByTimeAsync(5000);
  expect(requests).toHaveLength(3);
  expect(failures).toHaveBeenCalledTimes(3);
  expect(queue.suspended).toBe(true);
});
