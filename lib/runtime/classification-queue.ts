import { makeRequest } from '../classifier/client';
import { activeRules } from '../config/categories';
import { LIMITS } from '../config/defaults';
import type { AdCandidate, CandidateClassification, Settings } from '../shared/types';
import { parseClassifications, send } from './messages';
import { nextIdle } from './scheduler';

export interface PendingCandidate {
  readonly element: Element;
  readonly candidate: AdCandidate;
  readonly fingerprint: string;
  readonly generation: number;
}

interface QueueOptions {
  readonly runnable: () => boolean;
  readonly cacheEnabled: () => boolean;
  readonly ruleCount: () => number;
  readonly settings: () => Settings | null;
  readonly current: (pending: Readonly<PendingCandidate>) => boolean;
  readonly apply: (pending: Readonly<PendingCandidate>, result: CandidateClassification) => void;
  readonly wake: () => void;
  readonly fail: (message: string) => void;
  readonly generation: () => number;
  readonly checkNavigation: () => boolean;
}

export class ClassificationQueue {
  private readonly queue: PendingCandidate[] = [];
  private readonly decisions: {
    readonly pending: PendingCandidate;
    readonly result: CandidateClassification;
  }[] = [];
  private readonly cache = new Map<string, CandidateClassification>();
  private seen = new WeakMap<Element, string>();
  private active = false;
  private timer: number | undefined;
  private retryAt = 0;
  private retries = 0;
  suspended = false;
  readonly metrics = { sent: 0, dropped: 0, cacheHits: 0, latencyMs: 0 };

  constructor(private readonly options: QueueOptions) {}

  get size(): number {
    return this.queue.length;
  }
  get full(): boolean {
    return this.queue.length >= LIMITS.queue;
  }
  get hasDecisions(): boolean {
    return this.decisions.length > 0;
  }

  add(pending: Readonly<PendingCandidate>): boolean {
    if (this.seen.get(pending.element) === pending.fingerprint) return false;
    if (this.full) return false;
    this.seen.set(pending.element, pending.fingerprint);
    const cached = this.options.cacheEnabled() ? this.cache.get(pending.fingerprint) : undefined;
    if (cached === undefined) {
      if (
        this.queue.some(
          (entry) =>
            overlaps(pending, entry) &&
            ((pending.element.contains(entry.element) && !prefersContainer(pending.candidate)) ||
              (entry.element.contains(pending.element) && prefersContainer(entry.candidate))),
        )
      )
        return false;
      for (let index = this.queue.length - 1; index >= 0; index--) {
        const entry = this.queue[index];
        if (
          entry !== undefined &&
          overlaps(pending, entry) &&
          (entry.element.contains(pending.element) ||
            (prefersContainer(pending.candidate) && pending.element.contains(entry.element)))
        )
          this.queue.splice(index, 1);
      }
      this.queue.push(pending);
    } else {
      this.metrics.cacheHits++;
      this.decisions.push({ pending, result: cached });
    }
    return true;
  }

  forget(element: Element): void {
    this.seen.delete(element);
  }

  applyNext(): boolean {
    const decision = this.decisions.shift();
    if (decision === undefined) return false;
    this.options.apply(decision.pending, decision.result);
    return true;
  }

  reset(): void {
    this.cancel();
    this.clear();
    this.cache.clear();
    this.seen = new WeakMap();
    this.retryAt = 0;
    this.retries = 0;
    this.suspended = false;
  }

  clear(): void {
    this.queue.length = 0;
    this.decisions.length = 0;
  }
  cancel(): void {
    window.clearTimeout(this.timer);
    this.timer = undefined;
  }

  schedule(backlog = false): void {
    if (this.timer !== undefined || this.active) return;
    if (this.retryAt > 0) {
      this.timer = window.setTimeout(
        () => {
          this.timer = undefined;
          if (this.options.checkNavigation()) return;
          this.retryAt = 0;
          this.suspended = false;
          this.options.wake();
          this.schedule(true);
        },
        Math.max(0, this.retryAt - Date.now()),
      );
      return;
    }
    if (!this.options.runnable() || this.queue.length === 0) return;
    this.timer = window.setTimeout(
      () => {
        this.timer = undefined;
        this.classify().catch(() => {
          this.options.fail('Classification failed; content remains visible.');
        });
      },
      backlog ? 0 : 100,
    );
  }

  private async classify(): Promise<void> {
    if (!this.options.runnable() || this.active || this.options.checkNavigation()) return;
    this.active = true;
    const generation = this.options.generation();
    const batchSize = Math.min(
      LIMITS.batch,
      Math.floor(LIMITS.questions / Math.max(1, this.options.ruleCount())),
    );
    const original = this.fitBatch(this.queue.splice(0, batchSize));
    try {
      const batch = await this.prepare(original);
      if (generation !== this.options.generation() || this.options.checkNavigation()) return;
      if (!this.options.runnable()) {
        this.queue.unshift(...original.slice(0, LIMITS.queue - this.queue.length));
        return;
      }
      if (batch.length > 0) await this.request(batch, generation);
    } catch {
      if (generation === this.options.generation())
        this.options.fail('Classification failed; content remains visible.');
    } finally {
      this.active = false;
      if (generation === this.options.generation() && this.options.runnable()) this.options.wake();
      this.schedule(generation === this.options.generation());
    }
  }

  private fitBatch(batch: readonly PendingCandidate[]): readonly PendingCandidate[] {
    const settings = this.options.settings();
    if (settings === null) return [];
    let count = batch.length;
    while (count > 1) {
      try {
        makeRequest(
          settings.provider,
          batch.slice(0, count).map((entry) => entry.candidate),
          activeRules(settings).map((rule) => rule.text),
          settings.model,
        );
        break;
      } catch {
        count = Math.max(1, Math.floor(count / 2));
      }
    }
    const deferred = batch.slice(count);
    const available = Math.max(0, LIMITS.queue - this.queue.length);
    this.queue.unshift(...deferred.slice(0, available));
    this.metrics.dropped += Math.max(0, deferred.length - available);
    return batch.slice(0, count);
  }

  private async prepare(original: readonly PendingCandidate[]): Promise<PendingCandidate[]> {
    const batch: PendingCandidate[] = [];
    let index = 0;
    while (index < original.length && this.options.runnable()) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Sequential idle turns keep DOM validation off long main-thread tasks.
      await nextIdle();
      const started = performance.now();
      while (index < original.length && performance.now() - started < 6) {
        const pending = original[index++];
        if (pending === undefined || !this.options.current(pending)) continue;
        const cached = this.options.cacheEnabled()
          ? this.cache.get(pending.fingerprint)
          : undefined;
        if (cached === undefined) batch.push(pending);
        else {
          this.metrics.cacheHits++;
          this.decisions.push({ pending, result: cached });
        }
      }
    }
    return batch;
  }

  private async request(batch: readonly PendingCandidate[], generation: number): Promise<void> {
    const started = performance.now();
    const candidates = [
      ...new Map(batch.map((pending) => [pending.fingerprint, pending.candidate])).values(),
    ];
    this.metrics.sent += candidates.length;
    const response = parseClassifications(
      await send({ type: 'CLASSIFY', pageHost: location.hostname, generation, candidates }),
    );
    if (this.options.checkNavigation() || generation !== this.options.generation()) return;
    this.metrics.latencyMs = Math.round(performance.now() - started);
    if (!response.ok) {
      this.serviceFailure(batch, response.error, response.retryAfterMs);
      return;
    }
    if (
      response.results.some(
        (result) => result.ruleProbabilities.length !== this.options.ruleCount(),
      )
    ) {
      this.serviceFailure(batch, 'Invalid rule decisions. Content remains visible.');
      return;
    }
    this.retries = 0;
    this.acceptResults(response.results, batch);
    this.options.wake();
  }

  private serviceFailure(
    batch: readonly PendingCandidate[],
    message: string,
    delay?: number,
  ): void {
    const waiting = [...batch, ...this.queue].slice(0, LIMITS.queue);
    this.options.fail(message);
    if (delay === undefined || this.retries >= 2) return;
    this.retries++;
    this.retryAt = Date.now() + delay;
    this.queue.push(...waiting);
  }

  private acceptResults(
    results: readonly CandidateClassification[],
    batch: readonly PendingCandidate[],
  ): void {
    for (const result of results) {
      const pending = batch.find((entry) => entry.candidate.id === result.id);
      if (pending === undefined || result.ruleProbabilities.length !== this.options.ruleCount())
        continue;
      if (this.cache.size >= LIMITS.cacheEntries) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      if (this.options.cacheEnabled()) this.cache.set(pending.fingerprint, result);
      for (const matching of batch) {
        if (matching.fingerprint === pending.fingerprint)
          this.decisions.push({ pending: matching, result });
      }
    }
  }
}

function overlaps(first: Readonly<PendingCandidate>, second: Readonly<PendingCandidate>): boolean {
  return first.candidate.kind !== 'background' && second.candidate.kind !== 'background';
}

function prefersContainer(candidate: AdCandidate): boolean {
  return (
    candidate.kind === 'overlay' ||
    (candidate.display?.labelOnly === true && candidate.labels.includes('advertisement'))
  );
}
