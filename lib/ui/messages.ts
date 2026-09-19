import { browser } from 'wxt/browser';

import type { ExtensionMessage, PageStatus, PublicSettings } from '../shared/types';
import { isRecord, parseSettings, isCategoryId } from '../shared/validation';

export function element<T extends Element>(selector: string, constructor: { new (): T }): T {
  const match = document.querySelector(selector);
  if (!(match instanceof constructor)) throw new Error(`Missing interface element: ${selector}`);
  return match;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The extension could not complete this action.';
}

export async function sendSettings(message: ExtensionMessage): Promise<PublicSettings> {
  const response: unknown = await browser.runtime.sendMessage(message);
  if (!isRecord(response))
    throw new Error('Settings are unavailable. Reload the extension and try again.');
  if (response['ok'] === false && typeof response['error'] === 'string')
    throw new Error(response['error']);
  const settings = parseSettings(response['settings']);
  if (response['ok'] !== true || settings === null || typeof response['configured'] !== 'boolean') {
    throw new Error('The extension returned invalid settings.');
  }
  return { ok: true, settings, configured: response['configured'] };
}

export async function pageStatus(tabId: number): Promise<PageStatus> {
  const response: unknown = await browser.tabs.sendMessage(
    tabId,
    { type: 'GET_STATUS' } satisfies ExtensionMessage,
    { frameId: 0 },
  );
  if (
    !isRecord(response) ||
    typeof response['host'] !== 'string' ||
    typeof response['enabled'] !== 'boolean' ||
    typeof response['paused'] !== 'boolean' ||
    typeof response['waitingForActivation'] !== 'boolean' ||
    typeof response['error'] !== 'string' ||
    !isRecord(response['metrics']) ||
    !isRecord(response['hiddenByCategory'])
  ) {
    throw new Error('Page status is unavailable. Reload this tab and try again.');
  }
  const metrics = response['metrics'];
  function count(name: string): number {
    const value = metrics[name];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      throw new Error('The page returned invalid statistics.');
    return value;
  }
  return {
    host: response['host'],
    enabled: response['enabled'],
    paused: response['paused'],
    waitingForActivation: response['waitingForActivation'],
    error: response['error'],
    hiddenByCategory: parseCategoryCounts(response['hiddenByCategory']),
    metrics: {
      scanned: count('scanned'),
      candidates: count('candidates'),
      sent: count('sent'),
      hidden: count('hidden'),
      restored: count('restored'),
      dropped: count('dropped'),
      cacheHits: count('cacheHits'),
      queued: count('queued'),
      latencyMs: count('latencyMs'),
    },
  };
}

function parseCategoryCounts(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, number>> {
  const entries = Object.entries(value);
  if (entries.length > 20) throw new Error('The page returned invalid category statistics.');
  const counts = new Map<string, number>();
  for (const [id, count] of entries) {
    if (!isCategoryId(id) || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
      throw new Error('The page returned invalid category statistics.');
    counts.set(id, count);
  }
  return Object.fromEntries(counts);
}
