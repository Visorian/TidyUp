import { adSlotFingerprint, findAdSlot } from '../blocking/ad-slot';
import { extractCandidate } from '../candidates/extract';
import { candidateFingerprint } from '../candidates/fingerprint';
import { parseReplaySnapshot, type ReplayEntry } from '../classifier/replay-cache';
import type { AdCandidate, CandidateClassification, Settings } from '../shared/types';
import { isCacheEnabled, isRecord } from '../shared/validation';
import { send } from './messages';

export function regionSelector(element: Element): string | null {
  if (element.getRootNode() !== document) return null;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current !== null && parts.length < 12) {
    if (current.id === '') {
      const siblings = current.parentElement?.children;
      const index = siblings === undefined ? 1 : [...siblings].indexOf(current) + 1;
      parts.unshift(`${current.localName}:nth-child(${index})`);
    } else parts.unshift(`${current.localName}#${CSS.escape(current.id)}`);
    const selector = parts.join(' > ');
    if (selector.length > 1000) return null;
    const matches = document.querySelectorAll(selector);
    if (matches.length === 1 && matches[0] === element) return selector;
    current = current.parentElement;
  }
  return null;
}

interface ReplayOptions {
  readonly active: () => boolean;
  readonly hidden: (element: Element) => boolean;
  readonly apply: (
    element: Element,
    candidate: AdCandidate,
    result: CandidateClassification,
  ) => void;
}

export class ReplayRegions {
  private entries: readonly ReplayEntry[] = [];
  private epoch: string | null = null;
  private version = 0;
  private pending = new WeakSet<Element>();
  private checked = new WeakMap<Element, string>();
  private readonly observer = new MutationObserver(() => {
    this.scan();
  });

  constructor(private readonly options: ReplayOptions) {}

  async start(settings: Settings, generation: number): Promise<void> {
    this.stop();
    if (!isCacheEnabled(settings, location.hostname) || settings.debug) return;
    const version = this.version;
    const response = await send({ type: 'GET_REPLAY', pageHost: location.hostname, generation });
    if (
      version !== this.version ||
      !isRecord(response) ||
      JSON.stringify(response['settings']) !== JSON.stringify(settings)
    )
      return;
    const snapshot = parseReplaySnapshot(response['snapshot']);
    if (snapshot === null) return;
    this.epoch = snapshot.epoch;
    this.entries = snapshot.entries;
    if (this.entries.length === 0) return;
    this.observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    document.addEventListener('load', this.scan, true);
    document.addEventListener('DOMContentLoaded', this.scan);
    this.scan();
  }

  stop(): void {
    this.version++;
    this.observer.disconnect();
    document.removeEventListener('load', this.scan, true);
    document.removeEventListener('DOMContentLoaded', this.scan);
    this.entries = [];
    this.epoch = null;
    this.pending = new WeakSet();
    this.checked = new WeakMap();
  }

  remember(
    element: Element,
    candidate: AdCandidate,
    generation: number,
    target: Element = element,
  ): void {
    if (this.epoch === null) return;
    const slot =
      candidate.kind === undefined &&
      element instanceof HTMLElement &&
      target instanceof HTMLElement
        ? findAdSlot(element, target)
        : null;
    const slotFingerprint = slot === null ? null : adSlotFingerprint(slot);
    const selector = regionSelector(slot ?? element);
    if (selector === null) return;
    void send({
      type: 'REMEMBER_REGION',
      pageHost: location.hostname,
      generation,
      candidates: [candidate],
      selector,
      ...(slotFingerprint === null ? {} : { slotFingerprint }),
      epoch: this.epoch,
    }).catch(() => {});
  }

  private readonly scan = (): void => {
    if (!this.options.active()) return;
    for (const entry of this.entries) {
      let elements: NodeListOf<Element>;
      try {
        elements = document.querySelectorAll(entry.selector);
      } catch {
        continue;
      }
      if (elements.length !== 1) continue;
      const element = elements[0];
      if (element === undefined || this.options.hidden(element) || this.pending.has(element))
        continue;
      const slotFingerprint = entry.kind === 'ad-slot' ? adSlotFingerprint(element) : null;
      const candidate: AdCandidate | null =
        entry.kind === 'ad-slot'
          ? slotFingerprint === null
            ? null
            : {
                id: 'replay',
                kind: 'ad-slot',
                tag: element.localName,
                text: slotFingerprint,
                labels: ['advertisement'],
                linkHosts: [],
                pageHost: location.hostname,
              }
          : extractCandidate(element, 'replay', location.hostname);
      if (candidate === null) continue;
      const fingerprint = slotFingerprint ?? candidateFingerprint(candidate);
      if (this.checked.get(element) === fingerprint) continue;
      this.pending.add(element);
      const version = this.version;
      void this.match(element, candidate, fingerprint, entry, version)
        .catch(() => {})
        .finally(() => {
          if (version === this.version) this.pending.delete(element);
        });
    }
  };

  private async match(
    element: Element,
    candidate: AdCandidate,
    fingerprint: string,
    entry: ReplayEntry,
    version: number,
  ): Promise<void> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
    if (version !== this.version || !this.options.active()) return;
    this.checked.set(element, fingerprint);
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    if (hash === entry.fingerprintHash)
      this.options.apply(element, candidate, { id: candidate.id, ...entry.result });
  }
}
