import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  clearReplayCache,
  getReplayEntries,
  hashReplayFingerprint,
  parseReplaySnapshot,
  rememberReplay,
} from '../lib/classifier/replay-cache';
import { DEFAULT_SETTINGS } from '../lib/config/defaults';
import type { AdCandidate, Settings } from '../lib/shared/types';

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
const settings = { ...DEFAULT_SETTINGS, rules: ['Hide advertising.'] };
const url = 'https://news.example.org/article';
const candidate: AdCandidate = {
  id: 'region',
  tag: 'aside',
  text: 'Sponsored content',
  labels: [],
  linkHosts: [],
  pageHost: 'news.example.org',
};
const result = { id: candidate.id, probability: 0.99, ruleProbabilities: [0.99] };

async function remember(page = url, entry = candidate, selector = '#ad'): Promise<void> {
  const { epoch } = await getReplayEntries(page, settings);
  await rememberReplay(page, settings, selector, entry, result, epoch);
}

beforeEach(() => {
  storage.values.clear();
  storage.set.mockClear();
  storage.get.mockClear();
  vi.stubGlobal('navigator', {
    locks: { request: (_name: string, callback: () => unknown) => Promise.resolve(callback()) },
  });
});
afterEach(() => vi.useRealTimers());

it('remembers a locator for the whole site and stores hashed content and policy', async () => {
  await remember();
  const snapshot = await getReplayEntries(url, settings);
  expect(snapshot.entries).toEqual([
    {
      selector: '#ad',
      fingerprintHash: await hashReplayFingerprint(candidate),
      result: { probability: 0.99, ruleProbabilities: [0.99] },
    },
  ]);
  // A region learned on one page also applies to pages of the same site that were never seen.
  expect((await getReplayEntries('https://news.example.org/other', settings)).entries).toEqual(
    snapshot.entries,
  );
  expect((await getReplayEntries('https://other.example.org/', settings)).entries).toEqual([]);
  const persisted = JSON.stringify([...storage.values.values()]);
  for (const privateValue of [url, candidate.pageHost, candidate.text, settings.rules[0]])
    expect(persisted).not.toContain(privateValue);
  expect(parseReplaySnapshot(snapshot)).toEqual(snapshot);
});

it.each([
  { ...settings, threshold: 0.95 },
  { ...settings, rules: ['Hide subscriptions.'] },
  { ...settings, provider: 'openrouter' as const },
])('invalidates learned locators when settings change', async (changed: Settings) => {
  await remember();
  expect((await getReplayEntries(url, changed)).entries).toEqual([]);
});

it.each([
  { ...settings, cacheEnabled: false },
  { ...settings, cacheDisabledSites: [candidate.pageHost] },
  { ...settings, disabledSites: [candidate.pageHost] },
  { ...settings, enabled: false },
  { ...settings, debug: true },
  { ...settings, activation: 'manual' as const },
])('does not read or write replay entries when replay is disabled', async (changed: Settings) => {
  expect((await getReplayEntries(url, changed)).entries).toEqual([]);
  await rememberReplay(url, changed, '#ad', candidate, result, '');
  expect(storage.get).not.toHaveBeenCalled();
  expect(storage.set).not.toHaveBeenCalled();
});

it('prevents stale page snapshots from repopulating cleared entries', async () => {
  await remember();
  const snapshot = await getReplayEntries(url, settings);
  const other = { ...candidate, pageHost: 'other.example.org' };
  await remember('https://other.example.org/', other);
  await clearReplayCache(candidate.pageHost);
  await rememberReplay(url, settings, '#ad', candidate, result, snapshot.epoch);
  expect((await getReplayEntries(url, settings)).entries).toEqual([]);
  expect((await getReplayEntries('https://other.example.org/', settings)).entries).toHaveLength(1);
  await clearReplayCache();
  expect((await getReplayEntries('https://other.example.org/', settings)).entries).toEqual([]);
});

it('expires learned regions after seven days', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-01T12:00:00Z'));
  await remember();
  vi.setSystemTime(new Date('2026-09-08T12:00:00Z'));
  expect((await getReplayEntries(url, settings)).entries).toEqual([]);
});

it('bounds the learned regions per site and replaces an existing locator', async () => {
  await Array.from({ length: 70 }, (_, index) => index).reduce(
    (previous: Readonly<Promise<void>>, index) =>
      previous.then(() => remember(url, candidate, `#ad-${index}`)),
    Promise.resolve(),
  );
  const snapshot = await getReplayEntries(url, settings);
  expect(snapshot.entries).toHaveLength(64);
  expect(snapshot.entries[0]?.selector).toBe('#ad-6');
  await remember(url, { ...candidate, text: 'Replacement sponsor' }, '#ad-69');
  expect((await getReplayEntries(url, settings)).entries).toHaveLength(64);
});

it('rejects untrusted malformed responses and nonblocking decisions', async () => {
  expect(parseReplaySnapshot({ epoch: '', entries: [{ selector: 'body' }] })).toBeNull();
  await rememberReplay(url, settings, '#ad', candidate, { ...result, probability: 0.2 }, '');
  await rememberReplay(url, settings, 'body{display:none}', candidate, result, '');
  await rememberReplay(url, settings, '#ad', { ...candidate, pageHost: 'other.org' }, result, '');
  expect(storage.set).not.toHaveBeenCalled();
});

it('persists slot identity separately from changing creative content', async () => {
  const slotFingerprint = JSON.stringify(['div', 'sidebar', ['ad-slot']]);
  await rememberReplay(url, settings, '#sidebar', candidate, result, '', slotFingerprint);
  const snapshot = await getReplayEntries(url, settings);
  expect(snapshot.entries).toHaveLength(1);
  expect(snapshot.entries[0]).toMatchObject({ selector: '#sidebar', kind: 'ad-slot' });
  expect(snapshot.entries[0]?.fingerprintHash).not.toBe(await hashReplayFingerprint(candidate));
  expect(parseReplaySnapshot(snapshot)).toEqual(snapshot);
  expect(JSON.stringify([...storage.values.values()])).not.toContain(slotFingerprint);
  await clearReplayCache(candidate.pageHost);
  expect((await getReplayEntries(url, settings)).entries).toEqual([]);
});
