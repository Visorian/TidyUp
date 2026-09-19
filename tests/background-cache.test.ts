import { beforeEach, expect, it, vi } from 'vitest';

type Listener = (
  message: unknown,
  sender: { readonly id: string; readonly url: string },
  respond: (value: unknown) => void,
) => boolean;

const mocks = vi.hoisted(() => ({
  listener: vi.fn<(listener: Listener) => void>(),
  clearDecisions: vi.fn<(host?: string) => Promise<void>>(),
  clearReplay: vi.fn<(host?: string) => Promise<void>>(),
  restrictStorage: vi.fn<() => Promise<void>>(),
  publicSettings: vi.fn<() => Promise<unknown>>(),
  queryTabs: vi.fn<() => Promise<readonly { readonly id: number }[]>>(),
  sendMessage: vi.fn<(tabId: number, message: unknown) => Promise<void>>(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      id: 'test-extension',
      getURL: (path: string) => `chrome-extension://test-extension${path}`,
      onMessage: { addListener: mocks.listener },
    },
    tabs: { query: mocks.queryTabs, sendMessage: mocks.sendMessage },
  },
}));
vi.mock('wxt/utils/define-background', () => ({
  defineBackground: (main: () => void) => ({ main }),
}));
vi.mock('../lib/classifier/cache', () => ({ clearDecisionCache: mocks.clearDecisions }));
vi.mock('../lib/classifier/replay-cache', () => ({
  clearReplayCache: mocks.clearReplay,
  getReplayEntries: vi.fn<() => Promise<unknown>>(),
  rememberReplay: vi.fn<() => Promise<unknown>>(),
}));
vi.mock('../lib/classifier/service', () => ({
  runClassification: vi.fn<() => Promise<unknown>>(),
  runCacheLookup: vi.fn<() => Promise<unknown>>(),
}));
vi.mock('../lib/config/settings', () => ({
  restrictStorage: mocks.restrictStorage,
  publicSettings: mocks.publicSettings,
  readSettings: vi.fn<() => Promise<unknown>>(),
}));

import background from '../entrypoints/background';

beforeEach(() => {
  mocks.listener.mockClear();
  background.main();
  mocks.clearDecisions.mockReset();
  mocks.clearReplay.mockReset();
  mocks.restrictStorage.mockResolvedValue();
  mocks.publicSettings.mockResolvedValue({ enabled: true });
  mocks.queryTabs.mockReset().mockResolvedValue([{ id: 17 }]);
  mocks.sendMessage.mockReset().mockResolvedValue();
});

function clearCache(host?: string): Promise<unknown> {
  const listener = mocks.listener.mock.calls[0]?.[0];
  if (listener === undefined) throw new Error('Background listener was not registered');
  const response = Promise.withResolvers<unknown>();
  expect(
    listener(
      { type: 'CLEAR_CACHE', host },
      { id: 'test-extension', url: 'chrome-extension://test-extension/popup.html' },
      response.resolve,
    ),
  ).toBe(true);
  return response.promise;
}

it.each([undefined, 'golem.de'])(
  'invalidates decisions before rotating replay epochs and notifying tabs for %s',
  async (host) => {
    const decisionStarted = Promise.withResolvers<void>();
    const decisionFinished = Promise.withResolvers<void>();
    const replayStarted = Promise.withResolvers<void>();
    const replayFinished = Promise.withResolvers<void>();
    mocks.clearDecisions.mockImplementation(() => {
      decisionStarted.resolve();
      return decisionFinished.promise;
    });
    mocks.clearReplay.mockImplementation(() => {
      replayStarted.resolve();
      return replayFinished.promise;
    });

    const response = clearCache(host);
    await decisionStarted.promise;
    expect(mocks.clearDecisions).toHaveBeenCalledWith(host);
    expect(mocks.clearReplay).not.toHaveBeenCalled();
    expect(mocks.queryTabs).not.toHaveBeenCalled();

    decisionFinished.resolve();
    await replayStarted.promise;
    expect(mocks.clearReplay).toHaveBeenCalledWith(host);
    expect(mocks.queryTabs).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();

    replayFinished.resolve();
    await expect(response).resolves.toEqual({ enabled: true });
    expect(mocks.sendMessage).toHaveBeenCalledExactlyOnceWith(17, {
      type: 'SETTINGS_CHANGED',
    });
  },
);
