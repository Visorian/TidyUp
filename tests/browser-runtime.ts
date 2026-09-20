import { assert, candidate, element } from './browser-support';
import { candidateFingerprint } from '../lib/candidates/fingerprint';
import { ClassificationQueue } from '../lib/runtime/classification-queue';
import { MutationRoots, observeMutations } from '../lib/runtime/mutation-queue';
import type { PendingCandidate } from '../lib/runtime/classification-queue';

function createQueue(): ClassificationQueue {
  return new ClassificationQueue({
    runnable: () => false,
    cacheEnabled: () => false,
    ruleCount: () => 1,
    settings: () => null,
    current: () => true,
    apply: () => {},
    wake: () => {},
    fail: (message) => {
      throw new Error(message);
    },
    generation: () => 0,
    checkNavigation: () => false,
  });
}

function pending(id: string, value = candidate(id)): PendingCandidate {
  return {
    element: element(id),
    candidate: value,
    fingerprint: candidateFingerprint(value),
    generation: 0,
  };
}

export function checkQueueOverlap(): string {
  const queue = createQueue();
  const consentQueue = createQueue();
  const background = pending('skin');
  const banner = pending('banner');
  try {
    assert(
      queue.add(background) && queue.add(banner),
      'Background and descendant banner must both queue',
    );
    assert(queue.size === 2, 'Background must not replace descendant banner');
    queue.reset();
    assert(
      queue.add(banner) && queue.add(background),
      'Child-first scanning must retain both candidates',
    );
    assert(queue.size === 2, 'Both scanning orders must retain background and banner');
    queue.reset();
    const overlay = pending('second');
    const childCandidate = { ...overlay.candidate, id: 'agree', tag: 'button' };
    delete childCandidate.kind;
    const child = pending('agree', childCandidate);
    assert(
      consentQueue.add(child) && consentQueue.add(overlay),
      'Consent wrapper must replace queued child',
    );
    assert(consentQueue.size === 1, 'Consent controls must not be queued alongside their wrapper');
    consentQueue.reset();
    assert(
      consentQueue.add(overlay) && !consentQueue.add(child),
      'Queued consent wrapper must suppress later child',
    );
  } finally {
    queue.reset();
    consentQueue.reset();
  }
  return 'Backgrounds and descendant ads queue together while consent wrappers replace controls';
}

export async function checkDynamicMutations(): Promise<string> {
  const roots = new MutationRoots();
  const received = new Set<string | null>();
  const observer = new MutationObserver((records: readonly MutationRecord[]) => {
    for (const record of records) {
      received.add(record.attributeName);
      roots.add(record.target);
    }
  });
  const fixture = element('skin');
  const previousClass = fixture.className;
  const previousStyle = fixture.style.cssText;
  try {
    observeMutations(observer, fixture);
    fixture.classList.add('dynamic-advertisement');
    fixture.style.backgroundImage = "url('/tests/fixtures/ad-skin.svg?version=2')";
    await Promise.resolve();
    assert(
      received.has('class') && received.has('style'),
      'Class and style mutations must be observed',
    );
    assert(
      roots.take() === fixture,
      'Dynamic presentation changes must queue the affected root for scanning',
    );
    assert(
      candidate('skin').kind === 'background',
      'Changed background must remain available for classification',
    );
  } finally {
    observer.disconnect();
    roots.clear();
    fixture.className = previousClass;
    fixture.style.cssText = previousStyle;
  }
  return 'Dynamic class and style changes queue the affected region for scanning';
}
