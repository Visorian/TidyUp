import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../lib/config/defaults';
import { PageSession } from '../lib/runtime/page-session';
import type { ExtensionMessage, Settings } from '../lib/shared/types';

const runtime = vi.hoisted(() => ({
  listeners: new Set<
    (message: unknown, sender: unknown, respond: (response: unknown) => void) => void
  >(),
  sendMessage: vi.fn<(message: ExtensionMessage) => Promise<unknown>>(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage: runtime.sendMessage,
      onMessage: {
        addListener: runtime.listeners.add.bind(runtime.listeners),
        removeListener: runtime.listeners.delete.bind(runtime.listeners),
      },
    },
  },
}));

const observe = vi.fn<() => void>();
const disconnect = vi.fn<() => void>();
const requestIdleCallback = vi.fn<() => number>(() => 1);
let session: PageSession | undefined;
let page: URL;
let events: EventTarget;

function message(type: 'GET_STATUS' | 'RESCAN' | 'REVEAL' | 'SETTINGS_CHANGED'): unknown {
  let response: unknown;
  const respond = (value: unknown): void => {
    response = value;
  };
  for (const listener of runtime.listeners) listener({ type }, {}, respond);
  return response;
}

async function start(settings: Settings): Promise<void> {
  runtime.sendMessage.mockResolvedValue({ ok: true, configured: true, settings });
  session = new PageSession();
  session.start();
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  runtime.listeners.clear();
  runtime.sendMessage.mockReset();
  observe.mockClear();
  disconnect.mockClear();
  requestIdleCallback.mockClear();
  page = new URL('https://news.example.org/');
  events = new EventTarget();
  vi.stubGlobal('location', page);
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), {
      visibilityState: 'visible',
      isConnected: true,
    }),
  );
  vi.stubGlobal(
    'window',
    Object.assign(events, {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      requestIdleCallback,
      cancelIdleCallback: vi.fn<() => void>(),
    }),
  );
  vi.stubGlobal(
    'MutationObserver',
    class {
      readonly observe = observe;
      readonly disconnect = disconnect;
    },
  );
});

afterEach(() => {
  session?.stop();
  session = undefined;
  vi.useRealTimers();
});

const settings: Settings = { ...DEFAULT_SETTINGS, rules: ['Hide paid advertising.'] };

it('keeps manual pages idle until Run, and requires another Run after reveal or navigation', async () => {
  await start({ ...settings, activation: 'manual' });
  await vi.advanceTimersByTimeAsync(2000);
  expect(message('GET_STATUS')).toMatchObject({ enabled: true, waitingForActivation: true });
  expect(observe).not.toHaveBeenCalled();
  expect(requestIdleCallback).not.toHaveBeenCalled();
  expect(runtime.sendMessage.mock.calls).toEqual([[{ type: 'GET_SETTINGS' }]]);

  message('RESCAN');
  await vi.advanceTimersByTimeAsync(300);
  expect(message('GET_STATUS')).toMatchObject({ waitingForActivation: false, paused: false });
  expect(observe).toHaveBeenCalledOnce();
  expect(requestIdleCallback).toHaveBeenCalledOnce();

  message('REVEAL');
  await vi.advanceTimersByTimeAsync(2000);
  expect(message('GET_STATUS')).toMatchObject({ waitingForActivation: false, paused: true });
  expect(requestIdleCallback).toHaveBeenCalledOnce();
  message('RESCAN');
  page.pathname = '/another-article';
  events.dispatchEvent(new Event('popstate'));
  await vi.advanceTimersByTimeAsync(2000);
  expect(message('GET_STATUS')).toMatchObject({ waitingForActivation: true, paused: false });
  expect(observe).toHaveBeenCalledTimes(2);
  expect(requestIdleCallback).toHaveBeenCalledOnce();
});

it('starts automatic pages and cancels pending work when changed to manual', async () => {
  await start(settings);
  expect(observe).toHaveBeenCalledOnce();
  runtime.sendMessage.mockResolvedValue({
    ok: true,
    configured: true,
    settings: { ...settings, activation: 'manual' },
  });
  message('SETTINGS_CHANGED');
  await vi.advanceTimersByTimeAsync(2000);
  expect(message('GET_STATUS')).toMatchObject({ enabled: true, waitingForActivation: true });
  expect(disconnect).toHaveBeenCalled();
  expect(observe).toHaveBeenCalledOnce();
  expect(requestIdleCallback).not.toHaveBeenCalled();
});

it('does not start scanning without rules even after an explicit Run', async () => {
  await start(DEFAULT_SETTINGS);
  message('RESCAN');
  await vi.advanceTimersByTimeAsync(2000);
  expect(message('GET_STATUS')).toMatchObject({ enabled: false });
  expect(observe).not.toHaveBeenCalled();
  expect(requestIdleCallback).not.toHaveBeenCalled();
  expect(runtime.sendMessage.mock.calls).toEqual([[{ type: 'GET_SETTINGS' }]]);
});
