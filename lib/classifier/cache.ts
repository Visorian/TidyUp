import { browser } from 'wxt/browser';
import { candidateFingerprint } from '../candidates/fingerprint';
import type { AdCandidate, ClassificationResponse, Settings } from '../shared/types';
import { isCacheEnabled, isRecord } from '../shared/validation';
import { PROVIDERS } from './client';
import { POLICY_VERSION } from './policy';

const STORAGE_KEY = 'decisionCache';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 2048;

interface Entry {
  readonly hash: string;
  readonly site: string;
  readonly probability: number;
  readonly timestamp: number;
}
interface StoredCache {
  readonly epoch: string;
  readonly entries: readonly Entry[];
}
interface Lookup {
  readonly candidate: AdCandidate;
  readonly hash: string;
  readonly site: string;
}

type Evaluate = (candidates: readonly AdCandidate[]) => Promise<ClassificationResponse>;

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function lookups(candidates: readonly AdCandidate[], settings: Settings): Promise<Lookup[]> {
  const policy = JSON.stringify([
    POLICY_VERSION,
    PROVIDERS[settings.provider],
    settings.model,
    settings.rules,
  ]);
  return Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      hash: await hash(policy + candidateFingerprint(candidate)),
      site: await hash(candidate.pageHost),
    })),
  );
}

function parseEntry(value: unknown): Entry | null {
  if (
    !isRecord(value) ||
    typeof value['hash'] !== 'string' ||
    !/^[a-f\d]{64}$/u.test(value['hash']) ||
    typeof value['site'] !== 'string' ||
    !/^[a-f\d]{64}$/u.test(value['site']) ||
    typeof value['probability'] !== 'number' ||
    !Number.isFinite(value['probability']) ||
    value['probability'] < 0 ||
    value['probability'] > 1 ||
    typeof value['timestamp'] !== 'number' ||
    !Number.isFinite(value['timestamp']) ||
    value['timestamp'] > Date.now() ||
    Date.now() - value['timestamp'] >= TTL_MS
  )
    return null;
  return {
    hash: value['hash'],
    site: value['site'],
    probability: value['probability'],
    timestamp: value['timestamp'],
  };
}

async function readCache(): Promise<StoredCache> {
  const stored: unknown = await browser.storage.local.get(STORAGE_KEY);
  const value = isRecord(stored) ? stored[STORAGE_KEY] : undefined;
  if (!isRecord(value) || typeof value['epoch'] !== 'string' || !Array.isArray(value['entries']))
    return { epoch: '', entries: [] };
  const entries = value['entries']
    .slice(-MAX_ENTRIES)
    .map((entry) => parseEntry(entry))
    .filter((entry) => entry !== null);
  return { epoch: value['epoch'], entries };
}

export async function clearDecisionCache(host?: string): Promise<void> {
  const site = host === undefined ? undefined : await hash(host);
  await navigator.locks.request('tidyup-cache', async () => {
    const cache = await readCache();
    await browser.storage.local.set({
      [STORAGE_KEY]: {
        epoch: crypto.randomUUID(),
        entries: site === undefined ? [] : cache.entries.filter((entry) => entry.site !== site),
      },
    });
  });
}

export async function withDecisionCache(
  candidates: readonly AdCandidate[],
  settings: Settings,
  host: string,
  evaluate: Evaluate,
): Promise<ClassificationResponse> {
  if (!isCacheEnabled(settings, host)) return evaluate(candidates);
  const items = await lookups(candidates, settings);
  const snapshot = await navigator.locks.request('tidyup-cache', readCache);
  const probabilities = new Map(snapshot.entries.map((entry) => [entry.hash, entry.probability]));
  const missing = items.filter((item) => !probabilities.has(item.hash));
  const response =
    missing.length === 0
      ? ({ ok: true, results: [] } as const)
      : await evaluate(missing.map((item) => item.candidate));
  if (!response.ok) return response;
  const additions = collectDecisions(missing, response);
  if (additions === null)
    return { ok: false, error: 'Incomplete classification. Content remains visible.' };
  for (const entry of additions) probabilities.set(entry.hash, entry.probability);
  return navigator.locks.request('tidyup-cache', async () => {
    const current = await readCache();
    if (current.epoch !== snapshot.epoch)
      return { ok: false, error: 'Cache was cleared during evaluation. Content remains visible.' };
    if (additions.length > 0) await storeDecisions(current, additions);
    return {
      ok: true,
      results: items.map((item) => ({
        id: item.candidate.id,
        probability: probabilities.get(item.hash) ?? 0,
      })),
    };
  });
}

function collectDecisions(
  missing: readonly Lookup[],
  response: Extract<ClassificationResponse, { readonly ok: true }>,
): Entry[] | null {
  const entries: Entry[] = [];
  for (const item of missing) {
    const result = response.results.find((answer) => answer.id === item.candidate.id);
    if (result === undefined) return null;
    entries.push({
      hash: item.hash,
      site: item.site,
      probability: result.probability,
      timestamp: Date.now(),
    });
  }
  return entries;
}

async function storeDecisions(cache: StoredCache, additions: readonly Entry[]): Promise<void> {
  const entries = new Map(cache.entries.map((entry) => [entry.hash, entry]));
  for (const entry of additions) {
    entries.delete(entry.hash);
    entries.set(entry.hash, entry);
  }
  await browser.storage.local.set({
    [STORAGE_KEY]: {
      epoch: cache.epoch,
      entries: [...entries.values()].slice(-MAX_ENTRIES),
    },
  });
}
