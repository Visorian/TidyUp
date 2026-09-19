import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReplayRegions } from '../lib/runtime/replay-regions';
import { hashReplayFingerprint } from '../lib/classifier/replay-cache';
import { DEFAULT_SETTINGS } from '../lib/config/defaults';
import type {
  AdCandidate,
  CandidateClassification,
  ExtensionMessage,
  Settings,
} from '../lib/shared/types';

const mocks = vi.hoisted(() => ({
  send: vi.fn<(message: ExtensionMessage) => Promise<unknown>>(),
  extract: vi.fn<(element: Element, id: string, host: string) => AdCandidate | null>(),
}));
vi.mock('../lib/runtime/messages', () => ({ send: mocks.send }));
vi.mock('../lib/candidates/extract', () => ({ extractCandidate: mocks.extract }));
vi.mock('wxt/browser', () => ({ browser: {} }));

const settings = { ...DEFAULT_SETTINGS, rules: ['Hide advertisements.'] };
const candidate: AdCandidate = {
  id: 'replay',
  tag: 'aside',
  text: 'Sponsored content',
  labels: ['advertisement'],
  linkHosts: [],
  pageHost: 'news.example.org',
};
const apply =
  vi.fn<(element: Element, entry: AdCandidate, result: CandidateClassification) => void>();
const observe = vi.fn<() => void>();
const disconnect = vi.fn<() => void>();
let documentFixture: EventTarget;
let elements: readonly Element[];
let mutation: () => void;
let active: boolean;
let replay: ReplayRegions;
let fingerprintHash: string;

beforeEach(async () => {
  vi.stubGlobal('HTMLElement', function FixtureElement() {});
  elements = [new HTMLElement()];
  documentFixture = Object.assign(new EventTarget(), {
    querySelectorAll: () => elements,
  });
  vi.stubGlobal('document', documentFixture);
  vi.stubGlobal('location', { hostname: candidate.pageHost });
  vi.stubGlobal(
    'MutationObserver',
    class FixtureObserver {
      constructor(callback: () => void) {
        mutation = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  active = true;
  apply.mockReset();
  observe.mockReset();
  disconnect.mockReset();
  mocks.extract.mockReset().mockImplementation(() => candidate);
  fingerprintHash = await hashReplayFingerprint(candidate);
  mocks.send.mockReset().mockImplementation(() => Promise.resolve(response()));
  replay = new ReplayRegions({ active: () => active, hidden: () => false, apply });
});

afterEach(() => {
  replay.stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function response(): unknown {
  return {
    settings,
    snapshot: {
      epoch: '',
      entries: [
        {
          selector: '#ad',
          fingerprintHash,
          result: { probability: 0.99, ruleProbabilities: [0.99] },
        },
      ],
    },
  };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 10);
  });
}

it('applies a remembered match without waiting for scan or batch timers', async () => {
  const applied = Promise.withResolvers<void>();
  apply.mockImplementation(() => {
    applied.resolve();
  });
  const timer = vi.spyOn(globalThis, 'setTimeout');
  await replay.start(settings, 1);
  await applied.promise;
  expect(timer).not.toHaveBeenCalled();
  expect(apply).toHaveBeenCalledWith(elements[0], candidate, {
    id: 'replay',
    probability: 0.99,
    ruleProbabilities: [0.99],
  });
});

it('leaves changed content at the same selector visible', async () => {
  mocks.extract.mockReturnValue({ ...candidate, text: 'Editorial story' });
  await replay.start(settings, 1);
  await settle();
  expect(apply).not.toHaveBeenCalled();
});

it('checks newly inserted regions directly from the mutation observer', async () => {
  elements = [];
  await replay.start(settings, 1);
  expect(apply).not.toHaveBeenCalled();
  elements = [new HTMLElement()];
  const applied = Promise.withResolvers<void>();
  apply.mockImplementation(() => {
    applied.resolve();
  });
  mutation();
  await applied.promise;
  expect(apply).toHaveBeenCalledOnce();
});

it('ignores a pending snapshot after stop and removes document listeners', async () => {
  const pending = Promise.withResolvers<unknown>();
  mocks.send.mockReturnValue(pending.promise);
  const starting = replay.start(settings, 1);
  replay.stop();
  pending.resolve(response());
  await starting;
  expect(observe).not.toHaveBeenCalled();
  documentFixture.dispatchEvent(new Event('load'));
  documentFixture.dispatchEvent(new Event('DOMContentLoaded'));
  expect(mocks.extract).not.toHaveBeenCalled();
  expect(disconnect).toHaveBeenCalled();
});

it('ignores a completed fingerprint after stop', async () => {
  const digest = Promise.withResolvers<ArrayBuffer>();
  vi.spyOn(crypto.subtle, 'digest').mockReturnValueOnce(digest.promise);
  await replay.start(settings, 1);
  replay.stop();
  digest.resolve(Uint8Array.from(Buffer.from(fingerprintHash, 'hex')).buffer);
  await settle();
  expect(apply).not.toHaveBeenCalled();
});

it.each([
  { ...settings, cacheEnabled: false },
  { ...settings, debug: true },
])('does not request snapshots when replay is disabled', async (disabled: Settings) => {
  await replay.start(disabled, 1);
  expect(mocks.send).not.toHaveBeenCalled();
  expect(observe).not.toHaveBeenCalled();
});

it('leaves ambiguous selectors and inactive sessions alone', async () => {
  elements = [new HTMLElement(), new HTMLElement()];
  await replay.start(settings, 1);
  expect(mocks.extract).not.toHaveBeenCalled();
  elements = [new HTMLElement()];
  active = false;
  mutation();
  expect(mocks.extract).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
});

it('disconnects the observer and document events when stopped', async () => {
  elements = [];
  await replay.start(settings, 1);
  expect(observe).toHaveBeenCalledOnce();
  disconnect.mockClear();
  replay.stop();
  elements = [new HTMLElement()];
  documentFixture.dispatchEvent(new Event('load'));
  documentFixture.dispatchEvent(new Event('DOMContentLoaded'));
  mutation();
  expect(mocks.extract).not.toHaveBeenCalled();
  expect(disconnect).toHaveBeenCalledOnce();
});
