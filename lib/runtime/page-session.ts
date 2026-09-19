import { browser } from 'wxt/browser';
import { PresentationStore, watchPresentation } from '../blocking/hide';
import { enumerateElements, extractCandidate } from '../candidates/extract';
import { candidateFingerprint } from '../candidates/fingerprint';
import type { PageStatus, PublicSettings } from '../shared/types';
import { isCacheEnabled, isSiteEnabled } from '../shared/validation';
import { parsePublicSettings, receivePageMessage, send } from './messages';
import { IdleScheduler, createPageActivation } from './scheduler';
import { MutationRoots } from './mutation-queue';
import { ClassificationQueue } from './classification-queue';
import type { PendingCandidate } from './classification-queue';

export class PageSession {
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
  private readonly metrics = {
    scanned: 0,
    candidates: 0,
    hidden: 0,
    restored: 0,
  };
  private readonly queue = new ClassificationQueue({
    runnable: () => this.runnable(),
    cacheEnabled: () =>
      this.configuration !== null && isCacheEnabled(this.configuration.settings, location.hostname),
    ruleCount: () => this.configuration?.settings.rules.length ?? 0,
    settings: () => this.configuration?.settings ?? null,
    current: (pending) => this.current(pending),
    apply: (pending, probability) => {
      this.apply(pending, probability);
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
        this.activation.reveal();
        this.reset();
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
      this.configuration.settings.rules.length > 0 &&
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
    this.observer.observe(document, { childList: true, subtree: true, characterData: true });
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
    while (visited < 100 && performance.now() - started < 6) {
      if (this.restoreNext() || (this.runnable() && this.queue.applyNext())) {
        visited++;
        continue;
      }
      if (!this.runnable()) break;
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
      this.inspect(next.value);
    }
    this.queue.schedule();
    if (
      this.presentations.hasPending ||
      this.walker !== null ||
      this.roots.size > 0 ||
      this.queue.hasDecisions
    )
      this.schedule(0);
  }
  private restoreNext(): boolean {
    const change = this.presentations.restoreNext();
    if (change === undefined) return false;
    if (change.restored) {
      this.metrics.restored++;
      this.metrics.hidden = Math.max(0, this.metrics.hidden - 1);
    }
    if (change.root !== null) {
      this.queue.forget(change.root);
      this.addRoot(change.root);
    }
    return true;
  }
  private inspect(element: Element): void {
    this.metrics.scanned++;
    if (element.shadowRoot !== null && !this.observedShadows.has(element.shadowRoot)) {
      this.observedShadows.add(element.shadowRoot);
      this.observer.observe(element.shadowRoot, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
    if (this.presentations.has(element) || !element.isConnected) return;
    const candidate = extractCandidate(element, `candidate_${++this.sequence}`, location.hostname);
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
  private apply(pending: Readonly<PendingCandidate>, probability: number): void {
    if (!this.current(pending) || this.configuration === null) return;
    const { threshold, debug } = this.configuration.settings;
    if (this.presentations.apply(pending.element, probability, threshold, debug))
      this.metrics.hidden++;
    if (this.presentations.has(pending.element)) watchPresentation(this.observer, pending.element);
  }
  private fail(message: string): void {
    this.error = message;
    this.queue.suspended = true;
    this.cancelWork();
    this.queue.clear();
    if (this.presentations.hasPending) this.schedule(0);
  }
}
