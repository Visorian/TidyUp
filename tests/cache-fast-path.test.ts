import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearDecisionCache, withDecisionCache } from '../lib/classifier/cache';
import { runCacheLookup, runClassification } from '../lib/classifier/service';
import { DEFAULT_SETTINGS } from '../lib/config/defaults';
import type { AdCandidate, ClassificationResponse } from '../lib/shared/types';

const storage = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  return {
    values,
    get: vi.fn<(key: string) => Promise<Record<string, unknown>>>((key) =>
      Promise.resolve({ [key]: structuredClone(values.get(key)) }),
    ),
    set: vi.fn<(entries: Readonly<Record<string, unknown>>) => Promise<void>>((entries) => {
      for (const [key, value] of Object.entries(entries)) values.set(key, structuredClone(value));
      return Promise.resolve();
    }),
  };
});

vi.mock('wxt/browser', () => ({ browser: { storage: { local: storage } } }));

const settings = { ...DEFAULT_SETTINGS, rules: ['Hide subscription offers.'] };
const candidate: AdCandidate = {
  id: 'first-session',
  tag: 'aside',
  text: 'Subscribe to our newspaper.',
  labels: [],
  linkHosts: [],
  pageHost: 'news.example.org',
};

function evaluate(candidates: readonly AdCandidate[]): Promise<ClassificationResponse> {
  return Promise.resolve({
    ok: true,
    results: candidates.map(({ id }) => ({ id, probability: 0.95, ruleProbabilities: [0.95] })),
  });
}

beforeEach(() => {
  storage.values.clear();
  storage.get.mockClear();
  storage.set.mockClear();
  vi.stubGlobal('navigator', {
    locks: { request: (_name: string, callback: () => unknown) => Promise.resolve(callback()) },
  });
});
afterEach(() => {
  vi.useRealTimers();
});

function holdProviderRequests(
  release: Readonly<Promise<void>>,
  isFull: () => boolean,
  onFull: () => void,
): (name: string, callback: () => unknown) => Promise<unknown> {
  return async (name, callback) => {
    if (name === 'tidyup-classification') {
      if (isFull()) onFull();
      await release;
    }
    return callback();
  };
}

it('returns mixed-batch cache hits without waiting for a provider request', async () => {
  await withDecisionCache([candidate], settings, candidate.pageHost, evaluate);
  storage.values.set('settings', settings);
  const missing = { ...candidate, id: 'uncached', text: 'An unfamiliar region.' };
  const fetchMock = vi.spyOn(globalThis, 'fetch');
  await expect(runCacheLookup([candidate, missing], candidate.pageHost)).resolves.toEqual({
    ok: true,
    results: [{ id: candidate.id, probability: 0.95, ruleProbabilities: [0.95] }],
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('serves cached decisions while both provider queue slots are occupied', async () => {
  await withDecisionCache([candidate], settings, candidate.pageHost, evaluate);
  storage.values.set('settings', settings);
  storage.values.set('key:typesafe', 'test-key');
  const waiting = Promise.withResolvers<void>();
  const occupied = Promise.withResolvers<void>();
  let queued = 0;
  vi.stubGlobal('navigator', {
    locks: {
      request: holdProviderRequests(
        waiting.promise,
        () => {
          queued++;
          return queued === 2;
        },
        occupied.resolve,
      ),
    },
  });
  const missing = { ...candidate, text: 'An unfamiliar region.' };
  const first = runClassification([missing], candidate.pageHost);
  const second = runClassification([missing], candidate.pageHost);
  await occupied.promise;
  await expect(runClassification([candidate], candidate.pageHost)).resolves.toEqual({
    ok: true,
    results: [{ id: candidate.id, probability: 0.95, ruleProbabilities: [0.95] }],
  });
  await expect(runCacheLookup([candidate, missing], candidate.pageHost)).resolves.toMatchObject({
    ok: true,
    results: [{ id: candidate.id }],
  });
  await expect(runClassification([missing], candidate.pageHost)).resolves.toMatchObject({
    ok: false,
    error: 'The evaluation queue is temporarily full.',
  });
  storage.values.set('settings', { ...settings, enabled: false });
  waiting.resolve();
  await expect(first).resolves.toMatchObject({ ok: false });
  await expect(second).resolves.toMatchObject({ ok: false });
});

it('does not reuse decisions after cache clear or while site caching is disabled', async () => {
  await withDecisionCache([candidate], settings, candidate.pageHost, evaluate);
  storage.values.set('settings', { ...settings, cacheDisabledSites: [candidate.pageHost] });
  await expect(runCacheLookup([candidate], candidate.pageHost)).resolves.toEqual({
    ok: true,
    results: [],
  });
  storage.values.set('settings', settings);
  await clearDecisionCache(candidate.pageHost);
  await expect(runCacheLookup([candidate], candidate.pageHost)).resolves.toEqual({
    ok: true,
    results: [],
  });
});
