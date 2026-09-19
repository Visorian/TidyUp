import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../lib/config/defaults';
import type { ExtensionMessage, PublicSettings, Settings } from '../lib/shared/types';

class Control extends EventTarget {
  value = '';
  checked = false;
  disabled = false;
  hidden = false;
  textContent = '';
  get valueAsNumber(): number {
    return Number(this.value);
  }
}

const mocks = vi.hoisted(() => ({
  controls: new Map<string, Control>(),
  sendSettings: vi.fn<(message: ExtensionMessage) => Promise<PublicSettings>>(),
  sendMessage: vi.fn<(message: ExtensionMessage) => Promise<unknown>>(),
  readRules: vi.fn<() => Pick<Settings, 'rules' | 'categories'>>(() => ({
    rules: ['Hide ads.'],
    categories: [],
  })),
}));

vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage: mocks.sendMessage } } }));
vi.mock('../entrypoints/settings/navigation', () => ({
  initializeNavigation: vi.fn<() => void>(),
}));
vi.mock('../entrypoints/settings/rules', () => ({
  readRules: mocks.readRules,
  setRules: vi.fn<() => void>(),
}));
vi.mock('../lib/ui/messages', () => ({
  element: (selector: string) => control(selector),
  sendSettings: mocks.sendSettings,
  errorMessage: String,
}));

function control(selector: string): Control {
  let item = mocks.controls.get(selector);
  if (item === undefined) {
    item = new Control();
    mocks.controls.set(selector, item);
  }
  return item;
}

function change(selector: string, value: string): void {
  control(selector).value = value;
  control(selector).dispatchEvent(new Event(selector === '#api-key' ? 'input' : 'change'));
}

beforeEach(async () => {
  vi.resetModules();
  mocks.controls.clear();
  mocks.sendSettings.mockReset().mockImplementation((message) =>
    Promise.resolve({
      ok: true,
      configured: true,
      settings: message.type === 'SAVE_SETTINGS' ? message.settings : DEFAULT_SETTINGS,
    }),
  );
  mocks.sendMessage.mockReset().mockResolvedValue({ ok: true });
  mocks.readRules.mockClear();
  for (const name of [
    'HTMLElement',
    'HTMLFormElement',
    'HTMLFieldSetElement',
    'HTMLSelectElement',
    'HTMLInputElement',
    'HTMLButtonElement',
    'HTMLTextAreaElement',
    'HTMLParagraphElement',
  ])
    vi.stubGlobal(name, Control);
  await import('../entrypoints/settings/main');
  await vi.waitUntil(() => control('#provider').value === DEFAULT_SETTINGS.provider);
  mocks.sendSettings.mockClear();
});

it('tests the saved connection without saving unrelated draft changes', async () => {
  control('#enabled').checked = false;
  control('#test').dispatchEvent(new Event('click'));
  await vi.waitFor(() => {
    expect(control('#status').textContent).toContain('Connection successful');
  });
  expect(mocks.sendMessage).toHaveBeenCalledExactlyOnceWith({ type: 'TEST_CONNECTION' });
  expect(mocks.sendSettings).not.toHaveBeenCalled();
  expect(mocks.readRules).not.toHaveBeenCalled();
  expect(control('#enabled').checked).toBe(false);
});

it('requires connection edits to be saved before testing', async () => {
  change('#api-key', 'replacement-key');
  expect(control('#test').disabled).toBe(true);
  control('#test').dispatchEvent(new Event('click'));
  expect(mocks.sendMessage).not.toHaveBeenCalled();
  control('#settings-form').dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => {
    expect(control('#status').textContent).toBe('Settings saved.');
  });
  expect(mocks.sendSettings).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ type: 'SAVE_SETTINGS', apiKey: 'replacement-key' }),
  );
  expect(control('#test').disabled).toBe(false);
  expect(control('#api-key').value).toBe('');
});

it('defers key removal until save and allows undo', async () => {
  control('#clear-key').dispatchEvent(new Event('click'));
  expect(mocks.sendSettings).not.toHaveBeenCalled();
  expect(control('#api-key').disabled).toBe(true);
  expect(control('#test').disabled).toBe(true);
  control('#clear-key').dispatchEvent(new Event('click'));
  expect(control('#api-key').disabled).toBe(false);
  expect(control('#test').disabled).toBe(false);
  control('#settings-form').dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => {
    expect(control('#status').textContent).toBe('Settings saved.');
  });
  expect(mocks.sendSettings).toHaveBeenCalledExactlyOnceWith({
    type: 'SAVE_SETTINGS',
    settings: { ...DEFAULT_SETTINGS, rules: ['Hide ads.'] },
  });
});

it('removes the saved key only on the explicit save action', async () => {
  control('#clear-key').dispatchEvent(new Event('click'));
  expect(mocks.sendSettings).not.toHaveBeenCalled();
  control('#settings-form').dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => {
    expect(control('#status').textContent).toBe('Settings saved.');
  });
  expect(mocks.sendSettings).toHaveBeenCalledExactlyOnceWith({
    type: 'SAVE_SETTINGS',
    clearKey: true,
    settings: { ...DEFAULT_SETTINGS, rules: ['Hide ads.'] },
  });
});

it('does not transfer key removal to another provider', async () => {
  control('#clear-key').dispatchEvent(new Event('click'));
  change('#provider', 'openrouter');
  expect(control('#api-key').disabled).toBe(false);
  expect(control('#test').disabled).toBe(true);
  control('#settings-form').dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => {
    expect(control('#status').textContent).toBe('Settings saved.');
  });
  expect(mocks.sendSettings).toHaveBeenCalledExactlyOnceWith({
    type: 'SAVE_SETTINGS',
    settings: { ...DEFAULT_SETTINGS, rules: ['Hide ads.'], provider: 'openrouter' },
  });
});
