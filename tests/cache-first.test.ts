import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CacheFirst } from '../lib/runtime/cache-first';
import type { PendingCandidate } from '../lib/runtime/classification-queue';
import type { CandidateClassification, ExtensionMessage } from '../lib/shared/types';

const sendMessage = vi.hoisted(() => vi.fn<(message: ExtensionMessage) => Promise<unknown>>());
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage } } }));

interface Request {
  readonly message: Extract<ExtensionMessage, { readonly type: 'LOOKUP_CACHE' }>;
  readonly resolve: (response: unknown) => void;
}

const requests: Request[] = [];
const hit = vi.fn<(pending: Readonly<PendingCandidate>, result: CandidateClassification) => void>();
const miss = vi.fn<(pending: Readonly<PendingCandidate>) => boolean>();
const wake = vi.fn<() => void>();
let cache: CacheFirst;
let generation: number;
let enabled: boolean;

beforeEach(() => {
  vi.stubGlobal('HTMLElement', function FixtureElement() {});
  vi.stubGlobal('location', { hostname: 'news.example.org' });
  generation = 0;
  enabled = true;
  requests.length = 0;
  hit.mockReset();
  miss.mockReset().mockReturnValue(true);
  wake.mockReset();
  sendMessage.mockReset().mockImplementation((message) => {
    if (message.type !== 'LOOKUP_CACHE') throw new Error('Unexpected message');
    const deferred = Promise.withResolvers<unknown>();
    requests.push({ message, resolve: deferred.resolve });
    return deferred.promise;
  });
  cache = new CacheFirst({
    enabled: () => enabled,
    current: (entry) => entry.generation === generation,
    hit,
    miss,
    wake,
  });
});

afterEach(() => vi.unstubAllGlobals());

function pending(id: string): PendingCandidate {
  return {
    element: new HTMLElement(),
    fingerprint: id,
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

function resolve(index: number, ids: readonly string[] = []): void {
  const request = requests[index];
  if (request === undefined) throw new Error('Missing cache request');
  request.resolve({
    ok: true,
    results: ids.map((id) => ({ id, probability: 0.99, ruleProbabilities: [0.99] })),
  });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

it('applies later cache hits while earlier misses are still awaiting classification', async () => {
  const provider = Promise.withResolvers<void>();
  let providerComplete = false;
  miss.mockImplementation(() => {
    provider.promise
      .then(() => {
        providerComplete = true;
        return true;
      })
      .catch(() => {});
    return true;
  });
  cache.add(pending('uncached'));
  await flush();
  resolve(0);
  await flush();
  expect(miss).toHaveBeenCalledOnce();
  cache.add(pending('cached'));
  await flush();
  resolve(1, ['cached']);
  await flush();
  expect(hit).toHaveBeenCalledOnce();
  expect(hit.mock.calls[0]?.[0].candidate.id).toBe('cached');
  expect(providerComplete).toBe(false);
  provider.resolve();
});

it('keeps backpressured misses while applying hits and retries misses when capacity returns', async () => {
  miss.mockReturnValue(false);
  cache.add(pending('uncached'));
  cache.add(pending('cached'));
  await flush();
  resolve(0, ['cached']);
  await flush();
  expect(hit).toHaveBeenCalledOnce();
  expect(cache.size).toBe(1);
  miss.mockReturnValue(true);
  cache.drainMisses();
  expect(cache.size).toBe(0);
  expect(miss).toHaveBeenCalledTimes(2);
  expect(miss.mock.calls[1]?.[0].candidate.id).toBe('uncached');
});

it('ignores stale responses and starts the new generation without waiting for them', async () => {
  cache.add(pending('old'));
  await flush();
  generation++;
  cache.reset();
  cache.add(pending('new'));
  await flush();
  expect(requests).toHaveLength(2);
  resolve(0, ['old']);
  await flush();
  expect(hit).not.toHaveBeenCalled();
  expect(cache.size).toBe(1);
  resolve(1, ['new']);
  await flush();
  expect(hit).toHaveBeenCalledOnce();
  expect(hit.mock.calls[0]?.[0].candidate.id).toBe('new');
  expect(cache.size).toBe(0);
});

it('bounds pending lookups and misses and deduplicates the same element fingerprint', async () => {
  const entry = pending('first');
  expect(cache.add(entry)).toBe(true);
  expect(cache.add(entry)).toBe(false);
  for (let index = 1; index < 128; index++) expect(cache.add(pending(`${index}`))).toBe(true);
  expect(cache.full).toBe(true);
  expect(cache.add(pending('overflow'))).toBe(false);
  await flush();
  expect(requests[0]?.message.candidates).toHaveLength(16);
  expect(cache.full).toBe(true);
  resolve(0);
  await flush();
  expect(cache.full).toBe(false);
  expect(cache.size).toBe(112);
  expect(wake).toHaveBeenCalled();
});

it('uses classification when caching is disabled or the cache lookup fails', async () => {
  enabled = false;
  cache.add(pending('disabled'));
  await flush();
  expect(sendMessage).not.toHaveBeenCalled();
  enabled = true;
  sendMessage.mockRejectedValueOnce(new Error('Unavailable'));
  cache.add(pending('failed'));
  await flush();
  expect(miss).toHaveBeenCalledTimes(2);
  expect(miss.mock.calls[0]?.[0].candidate.id).toBe('disabled');
  expect(miss.mock.calls[1]?.[0].candidate.id).toBe('failed');
  expect(hit).not.toHaveBeenCalled();
});

it('does not apply cached results after the candidate becomes stale', async () => {
  cache.add(pending('changed'));
  await flush();
  generation++;
  resolve(0, ['changed']);
  await flush();
  expect(hit).not.toHaveBeenCalled();
  expect(miss).not.toHaveBeenCalled();
});
