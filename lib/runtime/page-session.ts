/* oxlint-disable import/max-dependencies, eslint/max-lines -- Keep bounded hidden-decision replay with the page presentation lifecycle. */
import { browser } from 'wxt/browser';
import { PresentationStore, watchPresentation } from '../blocking/hide';
import { enumerateElements, extractCandidate } from '../candidates/extract';
import { CandidateReadCache } from '../candidates/read-cache';
import { candidateFingerprint } from '../candidates/fingerprint';
import { activeRules, matchingCategoryIds, countHiddenCategories } from '../config/categories';
import type { CandidateClassification, PageStatus, PublicSettings } from '../shared/types';
import { isCacheEnabled, isSiteEnabled } from '../shared/validation';
import { parsePublicSettings, receivePageMessage, send } from './messages';
import { IdleScheduler, createPageActivation } from './scheduler';
import { MutationRoots, observeMutations } from './mutation-queue';
import { ClassificationQueue, type PendingCandidate } from './classification-queue';

interface HiddenDecision {
  readonly pending: PendingCandidate;
  readonly result: CandidateClassification;
  readonly categories: readonly string[];
}

export class PageSession {
  private readonly hiddenDecisions = new Map<Element, HiddenDecision>();
  private revealedDecisions: HiddenDecision[] = [];
  private configuration: PublicSettings | null = null;
  private readonly presentations = new PresentationStore();
  private readonly roots = new MutationRoots();
  private observedShadows = new WeakSet<ShadowRoot>();
  private walker: Generator<Element> | null = null;
  private generation = 0;
  private sequence = 0;
  private settingsRequest = 0;
  private href = location.href;
  private readonly activation = createPageActivation();
  private stopped = false;
  private error = '';
  private readonly scheduler = new IdleScheduler(() => {
    try {
      this.process();
    } catch {
      this.fail('Scanning paused after an internal error.');
    }
  });
  private readonly observer = new MutationObserver((records: readonly MutationRecord[]) => {
    this.mutations(records);
  });
  private readonly metrics = { scanned: 0, candidates: 0, hidden: 0, restored: 0 };
  private readonly queue = new ClassificationQueue({
    runnable: () => this.runnable(),
    cacheEnabled: () =>
      this.configuration !== null && isCacheEnabled(this.configuration.settings, location.hostname),
    ruleCount: () =>
      this.configuration === null ? 0 : activeRules(this.configuration.settings).length,
    settings: () => this.configuration?.settings ?? null,
    current: (pending) => this.current(pending),
    apply: (pending, result) => {
      this.apply(pending, result);
    },
    wake: () => {
      this.error = '';
      this.schedule(0);
    },
    fail: (message) => {
      this.fail(message);
    },
    generation: () => this.generation,
    checkNavigation: () => this.checkNavigation(),
  });
  start(): void {
    browser.runtime.onMessage.addListener(this.onMessage);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('popstate', this.onNavigation);
    window.addEventListener('hashchange', this.onNavigation);
    this.reloadSettings().catch(() => {
      this.fail('Could not load settings.');
    });
  }
  private readonly onMessage = (
    message: unknown,
    _sender: unknown,
    respond: (response: unknown) => void,
  ): void => {
    receivePageMessage(message, respond, {
      status: () => {
        this.checkNavigation();
        return this.status();
      },
      settingsChanged: () => {
        this.reset();
        this.activation.reset('manual');
        this.configuration = null;
        this.reloadSettings().catch(() => {
          this.fail('Could not load settings.');
        });
      },
      reveal: () => {
        if (this.checkNavigation() || this.activation.paused) return;
        const decisions = [...this.hiddenDecisions.values(), ...this.revealedDecisions];
        this.activation.reveal();
        this.reset();
        this.revealedDecisions = decisions;
      },
      hideAgain: () => {
        if (this.checkNavigation() || !this.activation.paused) return;
        this.activation.run();
        this.begin();
        this.schedule(0);
      },
      rescan: () => {
        this.checkNavigation();
        this.activation.run();
        this.reset();
        this.begin();
      },
    });
  };
  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.cancelWork();
    else {
      this.checkNavigation();
      this.schedule(150);
      this.queue.schedule();
    }
  };
  private readonly onNavigation = (): void => {
    this.checkNavigation();
  };
  private status(): PageStatus {
    return {
      host: location.hostname,
      enabled: this.allowed(),
      paused: this.activation.paused,
      waitingForActivation: this.allowed() && this.activation.waiting,
      error: this.error,
      hiddenByCategory: countHiddenCategories(
        [...this.hiddenDecisions.values()].map((decision) => decision.categories),
      ),
      metrics: {
        ...this.metrics,
        ...this.queue.metrics,
        queued: this.queue.size,
      },
    };
  }
  private allowed(): boolean {
    return (
      !this.stopped &&
      this.configuration !== null &&
      this.configuration.configured &&
      activeRules(this.configuration.settings).length > 0 &&
      isSiteEnabled(this.configuration.settings, location.hostname)
    );
  }
  private runnable(allowRestoration = false): boolean {
    return (
      this.allowed() &&
      this.activation.active &&
      (!this.queue.suspended || allowRestoration) &&
      document.visibilityState !== 'hidden'
    );
  }
  private async reloadSettings(): Promise<void> {
    const request = ++this.settingsRequest;
    const configuration = parsePublicSettings(await send({ type: 'GET_SETTINGS' }));
    if (this.stopped || request !== this.settingsRequest) return;
    this.reset();
    this.configuration = configuration;
    this.activation.reset(configuration?.settings.activation ?? 'manual');
    if (configuration === null) this.error = 'Could not load settings.';
    this.begin();
  }
  private begin(): void {
    if (!this.allowed() || !this.activation.active) return;
    observeMutations(this.observer, document);
    this.addRoot(document);
    this.schedule(300);
  }
  private reset(): void {
    this.generation++;
    this.cancelWork();
    this.observer.disconnect();
    this.observedShadows = new WeakSet();
    this.metrics.restored += this.presentations.restoreAll();
    this.metrics.hidden = 0;
    this.hiddenDecisions.clear();
    this.revealedDecisions = [];
    this.roots.clear();
    this.queue.reset();
    this.walker = null;
    this.error = '';
  }
  private cancelWork(): void {
    this.scheduler.cancel();
    this.queue.cancel();
  }
  stop(): void {
    this.stopped = true;
    this.settingsRequest++;
    this.reset();
    browser.runtime.onMessage.removeListener(this.onMessage);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('popstate', this.onNavigation);
    window.removeEventListener('hashchange', this.onNavigation);
  }
  private checkNavigation(): boolean {
    if (this.href === location.href) return false;
    this.href = location.href;
    this.activation.reset(this.configuration?.settings.activation ?? 'manual');
    this.reset();
    this.begin();
    return true;
  }
  private mutations(records: readonly MutationRecord[]): void {
    if (!this.allowed() || !this.activation.active) return;
    if (this.checkNavigation()) return;
    const targets =
      records.length > 64 ? [document] : [...new Set(records.map((record) => record.target))];
    this.presentations.queueChanges(targets);
    for (const target of targets)
      this.addRoot(
        target instanceof Element || target instanceof Document ? target : target.parentElement,
      );
    this.schedule(150);
  }
  private addRoot(root: Node | null): void {
    if (!this.roots.add(root)) this.queue.metrics.dropped++;
  }
  private schedule(delay: number): void {
    if (this.runnable(this.presentations.hasPending)) this.scheduler.schedule(delay);
  }
  private process(): void {
    if (!this.runnable(true) || this.checkNavigation()) return;
    const started = performance.now();
    let visited = 0;
    const reads = new CandidateReadCache();
    while (visited < 100 && performance.now() - started < 6) {
      if (
        this.restoreNext() ||
        (this.runnable() && (this.rehideNext() || this.queue.applyNext()))
      ) {
        reads.clear();
        visited++;
        continue;
      }
      if (!this.runnable() || this.queue.full) break;
      if (this.walker === null) {
        const root = this.roots.take();
        if (root === undefined) break;
        if (!root.isConnected) continue;
        this.walker = enumerateElements(root);
      }
      const next = this.walker.next();
      if (next.done === true) {
        this.walker = null;
        continue;
      }
      visited++;
      this.inspect(next.value, reads);
    }
    this.queue.schedule();
    if (
      this.presentations.hasPending ||
      (!this.queue.full && (this.walker !== null || this.roots.size > 0)) ||
      this.queue.hasDecisions ||
      this.revealedDecisions.length > 0
    )
      this.schedule(0);
  }
  private rehideNext(): boolean {
    const decision = this.revealedDecisions.shift();
    if (decision === undefined) return false;
    this.apply({ ...decision.pending, generation: this.generation }, decision.result);
    return true;
  }
  private restoreNext(): boolean {
    const change = this.presentations.restoreNext();
    if (change === undefined) return false;
    if (change.restored) {
      this.hiddenDecisions.delete(change.element);
      this.metrics.restored++;
      this.metrics.hidden = Math.max(0, this.metrics.hidden - 1);
    }
    if (change.root !== null) {
      this.queue.forget(change.element);
      this.queue.forget(change.root);
      this.addRoot(change.root);
    }
    return true;
  }
  private inspect(element: Element, reads: Readonly<CandidateReadCache>): void {
    this.metrics.scanned++;
    if (element.shadowRoot !== null && !this.observedShadows.has(element.shadowRoot)) {
      this.observedShadows.add(element.shadowRoot);
      observeMutations(this.observer, element.shadowRoot);
    }
    if (this.presentations.has(element) || !element.isConnected) return;
    const candidate = extractCandidate(
      element,
      `candidate_${++this.sequence}`,
      location.hostname,
      reads,
    );
    if (candidate === null) return;
    const fingerprint = candidateFingerprint(candidate);
    if (this.queue.add({ element, candidate, fingerprint, generation: this.generation }))
      this.metrics.candidates++;
  }
  private current(pending: Readonly<PendingCandidate>): boolean {
    if (
      !this.runnable() ||
      this.href !== location.href ||
      pending.generation !== this.generation ||
      !pending.element.isConnected ||
      this.presentations.has(pending.element)
    )
      return false;
    const current = extractCandidate(pending.element, pending.candidate.id, location.hostname);
    return current !== null && candidateFingerprint(current) === pending.fingerprint;
  }
  private apply(pending: Readonly<PendingCandidate>, result: CandidateClassification): void {
    if (!this.current(pending) || this.configuration === null) return;
    const { threshold, debug } = this.configuration.settings;
    const { element, candidate } = pending;
    if (this.presentations.apply(element, result.probability, threshold, debug, candidate.kind)) {
      this.metrics.hidden++;
      this.hiddenDecisions.set(element, {
        pending,
        result,
        categories: matchingCategoryIds(this.configuration.settings, result),
      });
    }
    if (this.presentations.has(element))
      watchPresentation(this.observer, this.presentations.target(element));
  }
  private fail(message: string): void {
    this.error = message;
    this.queue.suspended = true;
    this.cancelWork();
    this.queue.clear();
    if (this.presentations.hasPending) this.schedule(0);
  }
}
