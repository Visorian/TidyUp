import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearDecisionCache, withDecisionCache } from '../lib/classifier/cache';
import { runClassification } from '../lib/classifier/service';
import { DEFAULT_SETTINGS } from '../lib/config/defaults';
import type { AdCandidate, ClassificationResponse, Settings } from '../lib/shared/types';

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
    results: candidates.map(({ id }) => ({ id, probability: 0.95 })),
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

it('reuses persisted decisions across page IDs, requests only misses, and stores no page content', async () => {
  const classifier = vi.fn<typeof evaluate>(evaluate);
  await withDecisionCache([candidate], settings, candidate.pageHost, classifier);
  const reloaded = { ...candidate, id: 'reloaded-session' };
  const newRegion = { ...candidate, id: 'new-region', text: 'Another subscription offer.' };
  await expect(
    withDecisionCache([reloaded, newRegion], settings, candidate.pageHost, classifier),
  ).resolves.toEqual({
    ok: true,
    results: [
      { id: 'reloaded-session', probability: 0.95 },
      { id: 'new-region', probability: 0.95 },
    ],
  });
  expect(classifier.mock.calls).toEqual([[[candidate]], [[newRegion]]]);
  const persisted = JSON.stringify([...storage.values.values()]);
  expect(persisted).not.toContain(candidate.text);
  expect(persisted).not.toContain(candidate.pageHost);
  expect(persisted).not.toContain('Hide subscription offers.');
  expect(persisted).not.toContain('first-session');
});

it('reevaluates when a rule, provider, or site changes', async () => {
  const classifier = vi.fn<typeof evaluate>(evaluate);
  await withDecisionCache([candidate], settings, candidate.pageHost, classifier);
  await withDecisionCache(
    [candidate],
    { ...settings, rules: ['Hide sports news.'] },
    candidate.pageHost,
    classifier,
  );
  await withDecisionCache(
    [candidate],
    { ...settings, provider: 'openrouter' },
    candidate.pageHost,
    classifier,
  );
  const otherSite = { ...candidate, pageHost: 'other.example.org' };
  await withDecisionCache([otherSite], settings, otherSite.pageHost, classifier);
  expect(classifier).toHaveBeenCalledTimes(4);
});

it.each([
  { ...settings, cacheEnabled: false },
  { ...settings, cacheDisabledSites: [candidate.pageHost] },
])('bypasses stored decisions and writes when caching is disabled', async (disabled: Settings) => {
  await withDecisionCache([candidate], settings, candidate.pageHost, evaluate);
  storage.get.mockClear();
  storage.set.mockClear();
  const classifier = vi.fn<typeof evaluate>(evaluate);
  await withDecisionCache([candidate], disabled, candidate.pageHost, classifier);
  await withDecisionCache([candidate], disabled, candidate.pageHost, classifier);
  expect(classifier).toHaveBeenCalledTimes(2);
  expect(storage.get).not.toHaveBeenCalled();
  expect(storage.set).not.toHaveBeenCalled();
});

it('clears only the selected site, or all sites when no site is supplied', async () => {
  const other = { ...candidate, pageHost: 'other.example.org' };
  const classifier = vi.fn<typeof evaluate>(evaluate);
  await withDecisionCache([candidate], settings, candidate.pageHost, classifier);
  await withDecisionCache([other], settings, other.pageHost, classifier);
  await clearDecisionCache(candidate.pageHost);
  await withDecisionCache([other], settings, other.pageHost, classifier);
  expect(classifier).toHaveBeenCalledTimes(2);
  await withDecisionCache([candidate], settings, candidate.pageHost, classifier);
  expect(classifier).toHaveBeenCalledTimes(3);
  await clearDecisionCache();
  await withDecisionCache([candidate], settings, candidate.pageHost, classifier);
  await withDecisionCache([other], settings, other.pageHost, classifier);
  expect(classifier).toHaveBeenCalledTimes(5);
});

it('discards an in-flight decision when the cache is cleared and does not repopulate it', async () => {
  const started = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<ClassificationResponse>();
  const request = withDecisionCache([candidate], settings, candidate.pageHost, () => {
    started.resolve();
    return pending.promise;
  });
  await started.promise;
  await clearDecisionCache(candidate.pageHost);
  pending.resolve(await evaluate([candidate]));
  await expect(request).resolves.toMatchObject({ ok: false });
  const classifier = vi.fn<typeof evaluate>(evaluate);
  await withDecisionCache([candidate], settings, candidate.pageHost, classifier);
  expect(classifier).toHaveBeenCalledOnce();
});

it('expires persisted decisions after seven days', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-01T12:00:00Z'));
  const classifier = vi.fn<typeof evaluate>(evaluate);
  await withDecisionCache([candidate], settings, candidate.pageHost, classifier);
  vi.setSystemTime(new Date('2026-09-08T12:00:00Z'));
  await withDecisionCache([candidate], settings, candidate.pageHost, classifier);
  expect(classifier).toHaveBeenCalledTimes(2);
});

it('does not cache a service failure or an incomplete response', async () => {
  const classifier = vi
    .fn<typeof evaluate>()
    .mockResolvedValueOnce({ ok: false, error: 'Service unavailable.' })
    .mockResolvedValueOnce({ ok: true, results: [] })
    .mockImplementation(evaluate);
  await expect(
    withDecisionCache([candidate], settings, candidate.pageHost, classifier),
  ).resolves.toMatchObject({ ok: false });
  await expect(
    withDecisionCache([candidate], settings, candidate.pageHost, classifier),
  ).resolves.toMatchObject({ ok: false });
  expect(storage.set).not.toHaveBeenCalled();
  await expect(
    withDecisionCache([candidate], settings, candidate.pageHost, classifier),
  ).resolves.toEqual({ ok: true, results: [{ id: candidate.id, probability: 0.95 }] });
  expect(classifier).toHaveBeenCalledTimes(3);
});

it('returns no blocking decisions or service calls without rules, even with old cached decisions', async () => {
  await withDecisionCache([candidate], settings, candidate.pageHost, evaluate);
  storage.values.set('settings', DEFAULT_SETTINGS);
  storage.values.set('key:typesafe', 'test-key');
  const fetchMock = vi.spyOn(globalThis, 'fetch');
  await expect(runClassification([candidate], candidate.pageHost)).resolves.toEqual({
    ok: true,
    results: [],
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
