import { LIMITS } from '../config/defaults';
import type { CandidateClassification } from '../shared/types';
import type { PendingCandidate } from './classification-queue';
import { parseClassifications, send } from './messages';

interface CacheFirstOptions {
  readonly enabled: () => boolean;
  readonly current: (pending: Readonly<PendingCandidate>) => boolean;
  readonly hit: (pending: Readonly<PendingCandidate>, result: CandidateClassification) => void;
  readonly miss: (pending: Readonly<PendingCandidate>) => boolean;
  readonly wake: () => void;
}

export class CacheFirst {
  private readonly queue: PendingCandidate[] = [];
  private readonly misses: PendingCandidate[] = [];
  private seen = new WeakMap<Element, string>();
  private epoch = 0;
  private scheduled = false;
  private active = 0;

  constructor(private readonly options: CacheFirstOptions) {}

  get size(): number {
    return this.queue.length + this.misses.length + this.active;
  }

  get full(): boolean {
    return this.size >= 128;
  }

  add(pending: Readonly<PendingCandidate>): boolean {
    if (this.full || this.seen.get(pending.element) === pending.fingerprint) return false;
    this.seen.set(pending.element, pending.fingerprint);
    this.queue.push(pending);
    this.schedule();
    return true;
  }

  forget(element: Element): void {
    this.seen.delete(element);
  }

  drainMisses(): void {
    while (this.misses.length > 0) {
      const pending = this.misses[0];
      if (pending === undefined) break;
      if (this.options.current(pending) && !this.options.miss(pending)) break;
      this.misses.shift();
    }
  }

  reset(): void {
    this.epoch++;
    this.queue.length = 0;
    this.misses.length = 0;
    this.seen = new WeakMap();
    this.scheduled = false;
    this.active = 0;
  }

  private schedule(): void {
    if (this.scheduled || this.active > 0 || this.queue.length === 0) return;
    const epoch = this.epoch;
    this.scheduled = true;
    queueMicrotask(() => {
      if (epoch !== this.epoch) return;
      this.scheduled = false;
      this.lookup(epoch).catch(() => {
        this.options.wake();
      });
    });
  }

  private async lookup(epoch: number): Promise<void> {
    const batch = this.queue.splice(0, 16).filter((pending) => this.options.current(pending));
    const first = batch[0];
    if (first === undefined) {
      this.schedule();
      this.options.wake();
      return;
    }
    const message = {
      type: 'LOOKUP_CACHE' as const,
      pageHost: location.hostname,
      generation: first.generation,
      candidates: batch.map((pending) => pending.candidate),
    };
    while (new TextEncoder().encode(JSON.stringify(message)).length > LIMITS.payloadBytes) {
      const deferred = batch.pop();
      message.candidates.pop();
      if (deferred === undefined) break;
      if (batch.length === 0) this.misses.push(deferred);
      else this.queue.unshift(deferred);
    }
    this.active = batch.length;
    let results: readonly CandidateClassification[] = [];
    try {
      if (batch.length > 0 && this.options.enabled()) {
        const response = parseClassifications(await send(message));
        if (response.ok) results = response.results;
      }
    } catch {
      // Cache failures use the normal classification path.
    }
    if (epoch !== this.epoch) return;
    this.active = 0;
    for (const pending of batch) {
      if (!this.options.current(pending)) continue;
      const result = this.options.enabled()
        ? results.find((entry) => entry.id === pending.candidate.id)
        : undefined;
      if (result === undefined) this.misses.push(pending);
      else this.options.hit(pending, result);
    }
    this.drainMisses();
    this.schedule();
    this.options.wake();
  }
}
