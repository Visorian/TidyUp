import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { clearDecisionCache } from '../lib/classifier/cache';
import { runClassification, runCacheLookup } from '../lib/classifier/service';
import { clearReplayCache, getReplayEntries, rememberReplay } from '../lib/classifier/replay-cache';
import { parseCandidates } from '../lib/classifier/validate';
import { publicSettings, readSettings, restrictStorage } from '../lib/config/settings';
import { isPublicHost, isRecord, isSiteEnabled, parseSettings } from '../lib/shared/validation';

interface Sender {
  readonly id?: string | undefined;
  readonly url?: string | undefined;
  readonly tab?: { readonly id?: number | undefined } | undefined;
}

function isControl(sender: Sender): boolean {
  return sender.url !== undefined && sender.url.startsWith(browser.runtime.getURL('/'));
}

async function notifySettings(): Promise<void> {
  const tabs = await browser.tabs.query({});
  const notifications: Promise<unknown>[] = [];
  for (const tab of tabs) {
    if (tab.id !== undefined)
      notifications.push(browser.tabs.sendMessage(tab.id, { type: 'SETTINGS_CHANGED' }));
  }
  await Promise.allSettled(notifications);
}

async function save(message: Readonly<Record<string, unknown>>): Promise<unknown> {
  const settings = parseSettings(message['settings']);
  if (settings === null)
    return {
      ok: false,
      error: 'Invalid settings. Use exact public hostnames and a threshold from 90% to 100%.',
    };
  const key = message['apiKey'];
  if (key !== undefined && (typeof key !== 'string' || key.length > 4096 || /\s/u.test(key))) {
    return {
      ok: false,
      error: 'The API key must not contain whitespace and must be below 4096 characters.',
    };
  }
  await browser.storage.local.set({ settings });
  if (message['clearKey'] === true) await browser.storage.local.remove(`key:${settings.provider}`);
  else if (typeof key === 'string' && key.length > 0)
    await browser.storage.local.set({ [`key:${settings.provider}`]: key });
  // A corrected key or provider can be tested immediately after saving.
  await browser.storage.local.remove('service');
  await notifySettings();
  return publicSettings();
}

async function handle(message: unknown, sender: Sender): Promise<unknown> {
  if (sender.id !== browser.runtime.id || !isRecord(message))
    return { ok: false, error: 'Invalid extension request.' };
  await restrictStorage();
  if (message['type'] === 'GET_SETTINGS') return publicSettings();
  if (
    ['CLASSIFY', 'LOOKUP_CACHE', 'GET_REPLAY', 'REMEMBER_REGION'].includes(String(message['type']))
  )
    return handlePage(message, sender);
  if (!isControl(sender))
    return { ok: false, error: 'Open the extension controls to change settings.' };
  if (message['type'] === 'SAVE_SETTINGS')
    return navigator.locks.request('tidyup-settings', () => save(message));
  if (message['type'] === 'SET_SITE' || message['type'] === 'SET_SITE_CACHE')
    return navigator.locks.request('tidyup-settings', () => setSite(message));
  if (message['type'] === 'CLEAR_CACHE') {
    const host = message['host'];
    if (host !== undefined && (typeof host !== 'string' || !isPublicHost(host)))
      return { ok: false, error: 'Choose a public website.' };
    await clearDecisionCache(host);
    await clearReplayCache(host);
    await notifySettings();
    return publicSettings();
  }
  if (message['type'] === 'TEST_CONNECTION') {
    return runClassification([
      {
        id: 'connection_test',
        tag: 'aside',
        text: 'Sponsored placement: Buy our advertised shoes. Shop now.',
        labels: ['sponsored'],
        linkHosts: [],
        pageHost: 'example.com',
      },
    ]);
  }
  return { ok: false, error: 'Unknown extension request.' };
}

async function setSite(message: Readonly<Record<string, unknown>>): Promise<unknown> {
  const host = message['host'];
  const enabled = message['enabled'];
  if (typeof host !== 'string' || !isPublicHost(host) || typeof enabled !== 'boolean')
    return { ok: false, error: 'Choose a public website.' };
  const current = await readSettings();
  const field = message['type'] === 'SET_SITE_CACHE' ? 'cacheDisabledSites' : 'disabledSites';
  const sites = enabled
    ? current[field].filter((site) => site !== host)
    : [...new Set([...current[field], host])];
  if (sites.length > 200) return { ok: false, error: 'The excluded site list is full.' };
  await browser.storage.local.set({ settings: { ...current, [field]: sites } });
  await notifySettings();
  return publicSettings();
}

function onMessage(
  message: unknown,
  sender: Sender,
  sendResponse: (value: unknown) => void,
): boolean {
  if (
    !isRecord(message) ||
    ![
      'GET_SETTINGS',
      'CLASSIFY',
      'LOOKUP_CACHE',
      'GET_REPLAY',
      'REMEMBER_REGION',
      'SAVE_SETTINGS',
      'SET_SITE',
      'SET_SITE_CACHE',
      'CLEAR_CACHE',
      'TEST_CONNECTION',
    ].includes(String(message['type']))
  )
    return false;
  handle(message, sender)
    .then(sendResponse)
    .catch(() => {
      sendResponse({
        ok: false,
        error: 'The extension could not complete the request. Content remains visible.',
      });
    });
  return true;
}

export default defineBackground(() => {
  // WebExtension listeners return true to keep sendResponse alive; WXT types the callback as void.
  // oxlint-disable-next-line typescript/strict-void-return
  browser.runtime.onMessage.addListener(onMessage);
});

async function handlePage(
  message: Readonly<Record<string, unknown>>,
  sender: Sender,
): Promise<unknown> {
  const host = message['pageHost'];
  if (
    sender.tab === undefined ||
    sender.url === undefined ||
    typeof host !== 'string' ||
    !isPublicHost(host) ||
    typeof message['generation'] !== 'number' ||
    !Number.isSafeInteger(message['generation'])
  )
    return { ok: false, error: 'Invalid page request.' };
  const url = new URL(sender.url);
  const settings = await readSettings();
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.hostname !== host ||
    !isSiteEnabled(settings, host)
  ) {
    return { ok: false, error: 'Semantic blocking is disabled for this site.' };
  }
  const candidates = parseCandidates(message['candidates'], host);
  if (message['type'] === 'GET_REPLAY')
    return { ok: true, settings, snapshot: await getReplayEntries(sender.url, settings) };
  if (message['type'] === 'REMEMBER_REGION') {
    const selector = message['selector'];
    const epoch = message['epoch'];
    const candidate = candidates?.length === 1 ? candidates[0] : undefined;
    if (
      candidate === undefined ||
      typeof selector !== 'string' ||
      selector.length > 1000 ||
      typeof epoch !== 'string'
    )
      return { ok: false, error: 'Invalid remembered region.' };
    const cached = await runCacheLookup([candidate], host);
    const result = cached.ok ? cached.results[0] : undefined;
    if (result !== undefined)
      await rememberReplay(sender.url, settings, selector, candidate, result, epoch);
    return { ok: true };
  }
  return candidates === null
    ? { ok: false, error: 'Invalid candidate payload.' }
    : message['type'] === 'LOOKUP_CACHE'
      ? runCacheLookup(candidates, host)
      : runClassification(candidates, host);
}
