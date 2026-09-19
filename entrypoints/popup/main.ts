import { browser } from 'wxt/browser';

import type { ExtensionMessage, PublicSettings } from '../../lib/shared/types';
import { isPublicHost } from '../../lib/shared/validation';
import { element, errorMessage, pageStatus, sendSettings } from '../../lib/ui/messages';

const controls = element('#controls', HTMLFieldSetElement);
const enabled = element('#enabled', HTMLInputElement);
const site = element('#site', HTMLInputElement);
const cache = element('#cache-site', HTMLInputElement);
const clearCache = element('#clear-cache', HTMLButtonElement);
const status = element('#status', HTMLParagraphElement);
const notice = element('#notice', HTMLParagraphElement);
const reveal = element('#reveal', HTMLButtonElement);
const rescan = element('#rescan', HTMLButtonElement);
let current: PublicSettings | undefined;
let tabId: number | undefined;
let host = '';
let pageAvailable = false;

function render(): void {
  if (current === undefined) return;
  enabled.checked = current.settings.enabled;
  element('#power-label', HTMLElement).textContent = current.settings.enabled
    ? 'TidyUp is on'
    : 'TidyUp is paused';
  site.checked = isPublicHost(host) && !current.settings.disabledSites.includes(host);
  site.disabled = !isPublicHost(host);
  renderCache();
  const noRules = current.settings.rules.length === 0;
  element('#rules-empty', HTMLParagraphElement).hidden = !noRules;
  const provider = current.settings.provider === 'typesafe' ? 'TypeSafe' : 'OpenRouter';
  element('#provider-name', HTMLElement).textContent = provider;
  const count = current.settings.rules.length;
  element('#rules-link', HTMLElement).textContent = `${count} ${count === 1 ? 'rule' : 'rules'}`;
  const icon = element('#provider', HTMLElement);
  icon.dataset['provider'] = current.settings.provider;
  icon.title = provider;
  icon.setAttribute('aria-label', provider);
  element('#connection', HTMLElement).hidden = current.configured;
  reveal.disabled = !pageAvailable;
  rescan.textContent = current.settings.activation === 'manual' ? 'Run now' : 'Scan again';
  element('#activation', HTMLElement).textContent =
    current.settings.activation === 'manual' ? 'Manual activation' : 'Automatic activation';
  rescan.disabled =
    noRules || !pageAvailable || !current.configured || !current.settings.enabled || !site.checked;
}

function renderCache(): void {
  if (current === undefined) return;
  cache.checked = isPublicHost(host) && !current.settings.cacheDisabledSites.includes(host);
  cache.disabled = !isPublicHost(host) || !current.settings.cacheEnabled;
  clearCache.disabled = !isPublicHost(host);
  element('#cache-hint', HTMLElement).textContent = current.settings.cacheEnabled
    ? 'Reuse results on your next visit.'
    : 'Enable caching in Settings to use this.';
}

async function refreshPage(): Promise<void> {
  if (tabId === undefined || !isPublicHost(host)) {
    status.textContent = 'Open a public website to enable blocking.';
    return;
  }
  try {
    const page = await pageStatus(tabId);
    pageAvailable = true;
    element('#blocked', HTMLElement).textContent = String(page.metrics.hidden);
    if (page.error !== '') status.textContent = page.error;
    else if (page.waitingForActivation)
      status.textContent = 'Waiting for Run now. No content is being classified.';
    else if (page.paused) status.textContent = 'Content revealed. Run again to resume.';
    else if (page.enabled)
      status.textContent =
        current?.settings.debug === true
          ? 'Debug mode outlines candidates without hiding them.'
          : 'Following new content on this page.';
    else status.textContent = 'Blocking is off on this page.';
  } catch {
    pageAvailable = false;
    status.textContent = 'Reload this tab to start the extension.';
  }
}

async function perform(action: () => Promise<void>): Promise<void> {
  controls.disabled = true;
  notice.textContent = '';
  try {
    await action();
  } catch (error) {
    notice.textContent = errorMessage(error);
  } finally {
    controls.disabled = current === undefined;
    render();
  }
}

function run(action: () => Promise<void>): void {
  perform(action).catch((error: unknown) => {
    notice.textContent = errorMessage(error);
  });
}

enabled.addEventListener('change', () => {
  run(async () => {
    if (current === undefined) return;
    current = await sendSettings({
      type: 'SAVE_SETTINGS',
      settings: { ...current.settings, enabled: enabled.checked },
    });
    await refreshPage();
  });
});

site.addEventListener('change', () => {
  run(async () => {
    current = await sendSettings({ type: 'SET_SITE', host, enabled: site.checked });
    await refreshPage();
  });
});

cache.addEventListener('change', () => {
  run(async () => {
    current = await sendSettings({ type: 'SET_SITE_CACHE', host, enabled: cache.checked });
    await refreshPage();
  });
});

clearCache.addEventListener('click', () => {
  run(async () => {
    current = await sendSettings({ type: 'CLEAR_CACHE', host });
    await refreshPage();
    notice.textContent = 'Cached decisions cleared for this site.';
  });
});

async function actOnPage(type: 'REVEAL' | 'RESCAN'): Promise<void> {
  if (tabId === undefined) return;
  await browser.tabs.sendMessage(tabId, { type } satisfies ExtensionMessage);
  await refreshPage();
}

reveal.addEventListener('click', () => {
  run(() => actOnPage('REVEAL'));
});
rescan.addEventListener('click', () => {
  run(() => actOnPage('RESCAN'));
});
run(async () => {
  const [settings, tabs] = await Promise.all([
    sendSettings({ type: 'GET_SETTINGS' }),
    browser.tabs.query({ active: true, currentWindow: true }),
  ]);
  current = settings;
  const tab = tabs[0];
  tabId = tab?.id;
  if (tab?.url !== undefined) {
    const url = new URL(tab.url);
    if (url.protocol === 'https:' || url.protocol === 'http:') host = url.hostname;
  }
  element('#host', HTMLElement).textContent = host === '' ? 'No website selected' : host;
  await refreshPage();
});
