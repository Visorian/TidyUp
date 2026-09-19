import { browser } from 'wxt/browser';
import { candidateFingerprint } from '../candidates/fingerprint';
import { activeRules } from '../config/categories';
import type { AdCandidate, CandidateClassification, Settings } from '../shared/types';
import { isCacheEnabled, isRecord, parseRuleProbabilities } from '../shared/validation';
import { POLICY_VERSION } from './policy';

const STORAGE_KEY = 'replayCache';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 512;
const MAX_PAGE_ENTRIES = 64;

export interface ReplayEntry {
  readonly selector: string;
  readonly fingerprintHash: string;
  readonly result: {
    readonly probability: number;
    readonly ruleProbabilities: readonly number[];
  };
}

export interface ReplaySnapshot {
  readonly epoch: string;
  readonly entries: readonly ReplayEntry[];
}

interface StoredEntry extends ReplayEntry {
  readonly page: string;
  readonly site: string;
  readonly policy: string;
  readonly timestamp: number;
}

interface StoredCache {
  readonly epoch: string;
  readonly entries: readonly StoredEntry[];
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hashReplayFingerprint(candidate: AdCandidate): Promise<string> {
  return hash(candidateFingerprint(candidate));
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f\d]{64}$/u.test(value);
}

function validSelector(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > 1000 ||
    /[{};]/u.test(value)
  )
    return false;
  for (const character of value) {
    if (character < ' ' || character === String.fromCodePoint(127)) return false;
  }
  return true;
}

function pageHost(pageUrl: string, settings: Settings): string | null {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !settings.enabled ||
    settings.debug ||
    settings.activation !== 'automatic' ||
    settings.disabledSites.includes(url.hostname) ||
    !isCacheEnabled(settings, url.hostname) ||
    activeRules(settings).length === 0
  )
    return null;
  return url.hostname;
}

function parseEntry(value: unknown): StoredEntry | null {
  if (
    !isRecord(value) ||
    !validSelector(value['selector']) ||
    !validHash(value['fingerprintHash']) ||
    !validHash(value['page']) ||
    !validHash(value['site']) ||
    !validHash(value['policy']) ||
    typeof value['timestamp'] !== 'number' ||
    !Number.isFinite(value['timestamp']) ||
    value['timestamp'] > Date.now() ||
    Date.now() - value['timestamp'] >= TTL_MS ||
    !isRecord(value['result'])
  )
    return null;
  const result = value['result'];
  const scores = parseRuleProbabilities(result['ruleProbabilities']);
  if (scores === null || Math.max(...scores) !== result['probability']) return null;
  return {
    selector: value['selector'],
    fingerprintHash: value['fingerprintHash'],
    page: value['page'],
    site: value['site'],
    policy: value['policy'],
    timestamp: value['timestamp'],
    result: { probability: Math.max(...scores), ruleProbabilities: scores },
  };
}

export function parseReplaySnapshot(value: unknown): ReplaySnapshot | null {
  if (
    !isRecord(value) ||
    typeof value['epoch'] !== 'string' ||
    !Array.isArray(value['entries']) ||
    value['entries'].length > MAX_PAGE_ENTRIES
  )
    return null;
  const entries: ReplayEntry[] = [];
  for (const entry of value['entries']) {
    if (
      !isRecord(entry) ||
      !validSelector(entry['selector']) ||
      !validHash(entry['fingerprintHash']) ||
      !isRecord(entry['result'])
    )
      return null;
    const result = entry['result'];
    const scores = parseRuleProbabilities(result['ruleProbabilities']);
    if (scores === null || Math.max(...scores) !== result['probability']) return null;
    entries.push({
      selector: entry['selector'],
      fingerprintHash: entry['fingerprintHash'],
      result: { probability: Math.max(...scores), ruleProbabilities: scores },
    });
  }
  return { epoch: value['epoch'], entries };
}

async function readCache(): Promise<StoredCache> {
  const stored: unknown = await browser.storage.local.get(STORAGE_KEY);
  const value = isRecord(stored) ? stored[STORAGE_KEY] : undefined;
  if (!isRecord(value) || typeof value['epoch'] !== 'string' || !Array.isArray(value['entries']))
    return { epoch: '', entries: [] };
  return {
    epoch: value['epoch'],
    entries: value['entries']
      .slice(-MAX_ENTRIES)
      .map((entry: unknown) => parseEntry(entry))
      .filter((entry) => entry !== null),
  };
}

export async function getReplayEntries(
  pageUrl: string,
  settings: Settings,
): Promise<ReplaySnapshot> {
  if (pageHost(pageUrl, settings) === null) return { epoch: '', entries: [] };
  const [page, policy, cache] = await Promise.all([
    hash(pageUrl),
    hash(JSON.stringify([POLICY_VERSION, settings])),
    readCache(),
  ]);
  return {
    epoch: cache.epoch,
    entries: cache.entries
      .filter(
        (entry) =>
          entry.page === page &&
          entry.policy === policy &&
          entry.result.probability >= settings.threshold &&
          entry.result.ruleProbabilities.length === activeRules(settings).length,
      )
      .slice(-MAX_PAGE_ENTRIES)
      .map(({ selector, fingerprintHash, result }) => ({ selector, fingerprintHash, result })),
  };
}

export async function rememberReplay(
  pageUrl: string,
  settings: Settings,
  selector: string,
  candidate: AdCandidate,
  result: CandidateClassification,
  epoch: string,
): Promise<void> {
  const host = pageHost(pageUrl, settings);
  const scores = parseRuleProbabilities(result.ruleProbabilities);
  if (
    host === null ||
    host !== candidate.pageHost ||
    !validSelector(selector) ||
    result.id !== candidate.id ||
    scores === null ||
    scores.length !== activeRules(settings).length ||
    Math.max(...scores) !== result.probability ||
    result.probability < settings.threshold
  )
    return;
  const [page, site, policy, fingerprintHash] = await Promise.all([
    hash(pageUrl),
    hash(host),
    hash(JSON.stringify([POLICY_VERSION, settings])),
    hashReplayFingerprint(candidate),
  ]);
  await storeReplay(
    {
      page,
      site,
      policy,
      selector,
      fingerprintHash,
      timestamp: Date.now(),
      result: { probability: result.probability, ruleProbabilities: scores },
    },
    epoch,
  );
}

async function storeReplay(addition: StoredEntry, epoch: string): Promise<void> {
  const { page, policy, selector } = addition;
  await navigator.locks.request('tidyup-replay', async () => {
    const current = await readCache();
    if (current.epoch !== epoch) return;
    const others = current.entries.filter((entry) => entry.page !== page);
    const samePage = current.entries
      .filter(
        (entry) => entry.page === page && entry.policy === policy && entry.selector !== selector,
      )
      .slice(-(MAX_PAGE_ENTRIES - 1));
    await browser.storage.local.set({
      [STORAGE_KEY]: {
        epoch: current.epoch,
        entries: [...others, ...samePage, addition].slice(-MAX_ENTRIES),
      },
    });
  });
}

export async function clearReplayCache(host?: string): Promise<void> {
  const site = host === undefined ? undefined : await hash(host);
  await navigator.locks.request('tidyup-replay', async () => {
    const cache = await readCache();
    await browser.storage.local.set({
      [STORAGE_KEY]: {
        epoch: crypto.randomUUID(),
        entries: site === undefined ? [] : cache.entries.filter((entry) => entry.site !== site),
      },
    });
  });
}
