import { browser } from 'wxt/browser';

import type { ExtensionMessage, Provider, PublicSettings, Settings } from '../../lib/shared/types';
import { isRecord, parseSettings } from '../../lib/shared/validation';
import { element, errorMessage, sendSettings } from '../../lib/ui/messages';
import { readRules, setRules } from './rules';
import { initializeNavigation } from './navigation';

initializeNavigation();

const form = element('#settings-form', HTMLFormElement);
const controls = element('#controls', HTMLFieldSetElement);
const provider = element('#provider', HTMLSelectElement);
const model = element('#model', HTMLSelectElement);
const key = element('#api-key', HTMLInputElement);
const clearKey = element('#clear-key', HTMLButtonElement);
const connectionTest = element('#test', HTMLButtonElement);
const activation = element('#activation', HTMLSelectElement);
const enabled = element('#enabled', HTMLInputElement);
const threshold = element('#threshold', HTMLInputElement);
const debug = element('#debug', HTMLInputElement);
const cache = element('#cache-enabled', HTMLInputElement);
const sites = element('#sites', HTMLTextAreaElement);
const status = element('#status', HTMLParagraphElement);
const error = element('#error', HTMLParagraphElement);
let current: PublicSettings | undefined;
let removeKey = false;

function selectedProvider(): Provider {
  if (provider.value === 'typesafe' || provider.value === 'openrouter') return provider.value;
  throw new Error('Choose TypeSafe or OpenRouter.');
}

function showKeyStatus(): void {
  const message = element('#key-status', HTMLElement);
  element('#model-field', HTMLElement).hidden = provider.value !== 'openrouter';
  if (current === undefined) return;
  const sameProvider = provider.value === current.settings.provider;
  clearKey.hidden = !sameProvider || !current.configured;
  clearKey.textContent = removeKey ? 'Keep saved key' : 'Remove saved key';
  key.disabled = removeKey;
  if (removeKey) {
    message.textContent = 'The saved key will be removed when you save.';
  } else if (sameProvider) {
    message.textContent = current.configured
      ? 'A key is saved for this provider.'
      : 'No key is saved for this provider.';
  } else {
    message.textContent = 'A previously saved key for this provider will be kept.';
  }
  updateConnectionTest();
}

function updateConnectionTest(): void {
  if (current === undefined) return;
  const changed =
    provider.value !== current.settings.provider ||
    (provider.value === 'openrouter' && model.value !== current.settings.model) ||
    key.value.trim() !== '' ||
    removeKey;
  connectionTest.disabled = changed || !current.configured;
  element('#test-hint', HTMLElement).textContent = changed
    ? 'Save your connection changes before testing.'
    : current.configured
      ? 'Tests a fixed example without sending page content.'
      : 'Add and save an API key before testing.';
}

function render(): void {
  if (current === undefined) return;
  provider.value = current.settings.provider;
  model.value = current.settings.model;
  enabled.checked = current.settings.enabled;
  activation.value = current.settings.activation;
  threshold.value = String(current.settings.threshold * 100);
  debug.checked = current.settings.debug;
  cache.checked = current.settings.cacheEnabled;
  setRules(current.settings);
  sites.value = current.settings.disabledSites.join('\n');
  key.value = '';
  removeKey = false;
  showKeyStatus();
}

function readSettings(): Settings {
  const settings = parseSettings({
    enabled: enabled.checked,
    activation: activation.value,
    provider: selectedProvider(),
    model: model.value,
    threshold: threshold.valueAsNumber / 100,
    debug: debug.checked,
    ...readRules(),
    cacheEnabled: cache.checked,
    cacheDisabledSites: current?.settings.cacheDisabledSites ?? [],
    disabledSites: sites.value
      .split(/\r?\n/u)
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host !== ''),
  });
  if (settings === null)
    throw new Error(
      'Use a confidence between 90% and 100% and at most 200 public hostnames, one per line. URLs, wildcards, and internal addresses are not accepted.',
    );
  return settings;
}

async function save(): Promise<void> {
  const settings = readSettings();
  const apiKey = key.value.trim();
  current = await sendSettings({
    type: 'SAVE_SETTINGS',
    settings,
    ...(removeKey ? { clearKey: true } : apiKey === '' ? {} : { apiKey }),
  });
  render();
  status.textContent = 'Settings saved.';
}

async function perform(action: () => Promise<void>): Promise<void> {
  controls.disabled = true;
  error.textContent = '';
  status.textContent = '';
  try {
    await action();
  } catch (reason) {
    error.textContent = errorMessage(reason);
  } finally {
    controls.disabled = current === undefined;
  }
}

function run(action: () => Promise<void>): void {
  perform(action).catch((reason: unknown) => {
    error.textContent = errorMessage(reason);
  });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  run(() => save());
});

provider.addEventListener('change', () => {
  key.value = '';
  removeKey = false;
  showKeyStatus();
});

key.addEventListener('input', updateConnectionTest);
model.addEventListener('change', updateConnectionTest);
clearKey.addEventListener('click', () => {
  removeKey = !removeKey;
  key.value = '';
  showKeyStatus();
});

element('#clear-cache', HTMLButtonElement).addEventListener('click', () => {
  run(async () => {
    current = await sendSettings({ type: 'CLEAR_CACHE' });
    status.textContent = 'Cached decisions cleared for all sites.';
  });
});

connectionTest.addEventListener('click', () => {
  if (connectionTest.disabled) return;
  run(async () => {
    status.textContent = 'Testing connection…';
    const response: unknown = await browser.runtime.sendMessage({
      type: 'TEST_CONNECTION',
    } satisfies ExtensionMessage);
    if (!isRecord(response) || response['ok'] !== true) {
      const detail =
        isRecord(response) && typeof response['error'] === 'string'
          ? response['error']
          : 'The provider returned an invalid response.';
      throw new Error(detail);
    }
    status.textContent =
      'Connection successful. The service returned a decision for the test example.';
  });
});

run(async () => {
  current = await sendSettings({ type: 'GET_SETTINGS' });
  render();
});
