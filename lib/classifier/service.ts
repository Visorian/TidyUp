import { browser } from 'wxt/browser';
import { LIMITS } from '../config/defaults';
import { readKey, readSettings } from '../config/settings';
import type { AdCandidate, ClassificationResponse, Settings } from '../shared/types';
import { isRecord, isSiteEnabled } from '../shared/validation';
import { withDecisionCache } from './cache';
import { classify, ServiceError } from './client';

// Only queue occupancy is transient. The request lease and cooldown survive background restarts.
let pendingRequests = 0;

export async function runClassification(
  candidates: readonly AdCandidate[],
  pageHost?: string,
): Promise<ClassificationResponse> {
  if (pendingRequests >= 2)
    return {
      ok: false,
      error: 'The evaluation queue is temporarily full.',
      retryAfterMs: LIMITS.timeoutMs + 1000,
    };
  pendingRequests++;
  try {
    return await navigator.locks.request('tidyup-classification', () =>
      evaluateCandidates(candidates, pageHost),
    );
  } finally {
    pendingRequests--;
  }
}

async function evaluateCandidates(
  candidates: readonly AdCandidate[],
  pageHost?: string,
): Promise<ClassificationResponse> {
  const settings = await readSettings();
  if (pageHost !== undefined && !isSiteEnabled(settings, pageHost))
    return { ok: false, error: 'Blocking is disabled for this site.' };
  if (pageHost !== undefined && settings.rules.length === 0) return { ok: true, results: [] };
  const key = await readKey(settings.provider);
  if (key.length === 0)
    return { ok: false, error: 'Add a key for the selected provider in settings.' };
  const rules =
    pageHost === undefined ? ['The region contains the word Sponsored.'] : settings.rules;
  const evaluate = (batch: readonly AdCandidate[]): Promise<ClassificationResponse> =>
    prepareRequest(batch, settings, key, rules);
  const response =
    pageHost === undefined
      ? await evaluate(candidates)
      : await withDecisionCache(candidates, settings, pageHost, evaluate);
  if (
    JSON.stringify(await readSettings()) !== JSON.stringify(settings) ||
    (await readKey(settings.provider)) !== key
  )
    return { ok: false, error: 'Settings changed during evaluation. Content remains visible.' };
  return response;
}

async function prepareRequest(
  candidates: readonly AdCandidate[],
  settings: Settings,
  key: string,
  rules: readonly string[],
): Promise<ClassificationResponse> {
  const stored: unknown = await browser.storage.local.get('service');
  const service = isRecord(stored) && isRecord(stored['service']) ? stored['service'] : {};
  const nextAllowed = typeof service['nextAllowed'] === 'number' ? service['nextAllowed'] : 0;
  const failures = typeof service['failures'] === 'number' ? service['failures'] : 0;
  if (Date.now() < nextAllowed) {
    return {
      ok: false,
      error: 'Evaluation is temporarily paused. Content remains visible.',
      retryAfterMs: Math.min(nextAllowed - Date.now(), 300_000),
    };
  }
  // A persisted lease prevents a restarted background from duplicating an in-flight request.
  await browser.storage.local.set({
    service: { nextAllowed: Date.now() + LIMITS.timeoutMs + 1000, failures },
  });
  return performRequest(candidates, settings, key, failures, rules);
}

async function performRequest(
  candidates: readonly AdCandidate[],
  settings: Settings,
  key: string,
  failures: number,
  rules: readonly string[],
): Promise<ClassificationResponse> {
  try {
    const results = await classify(settings.provider, key, candidates, rules, settings.model);
    await browser.storage.local.set({ service: { nextAllowed: 0, failures: 0 } });
    if (
      JSON.stringify(await readSettings()) !== JSON.stringify(settings) ||
      (await readKey(settings.provider)) !== key
    ) {
      return {
        ok: false,
        error: 'Settings changed during evaluation. Content remains visible.',
      };
    }
    return { ok: true, results };
  } catch (error) {
    const delay = Math.min(
      300_000,
      Math.max(
        error instanceof ServiceError ? error.retryAfterMs : 30_000,
        1000 * 2 ** Math.min(failures + 1, 8),
      ),
    );
    await browser.storage.local.set({
      service: { nextAllowed: Date.now() + delay, failures: Math.min(failures + 1, 8) },
    });
    return {
      ok: false,
      error:
        error instanceof ServiceError
          ? error.message
          : 'The service is unavailable. Content remains visible.',
      retryAfterMs: delay,
    };
  }
}
