import type { ActivationMode } from '../shared/types';

export function createPageActivation(): {
  readonly active: boolean;
  readonly waiting: boolean;
  readonly paused: boolean;
  readonly reset: (mode: ActivationMode) => void;
  readonly run: () => void;
  readonly reveal: () => void;
} {
  let state: 'waiting' | 'running' | 'revealed' = 'waiting';
  return {
    get active() {
      return state === 'running';
    },
    get waiting() {
      return state === 'waiting';
    },
    get paused() {
      return state === 'revealed';
    },
    reset(mode) {
      state = mode === 'automatic' ? 'running' : 'waiting';
    },
    run() {
      state = 'running';
    },
    reveal() {
      state = 'revealed';
    },
  };
}

export function scheduleIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(callback, { timeout: 1500 });
    return () => {
      window.cancelIdleCallback(handle);
    };
  }
  const handle = window.setTimeout(callback, 16);
  return () => {
    window.clearTimeout(handle);
  };
}

export async function nextIdle(): Promise<void> {
  await new Promise<void>((resolve) => {
    scheduleIdle(() => {
      resolve();
    });
  });
}

export class IdleScheduler {
  private timer: number | undefined;
  private cancelIdle: (() => void) | undefined;
  private firstPendingAt = 0;

  constructor(private readonly callback: () => void) {}

  schedule(delay: number): void {
    if (this.cancelIdle !== undefined) return;
    if (this.firstPendingAt === 0) this.firstPendingAt = performance.now();
    window.clearTimeout(this.timer);
    const remaining = Math.max(0, 1500 - (performance.now() - this.firstPendingAt));
    this.timer = window.setTimeout(
      () => {
        this.timer = undefined;
        this.firstPendingAt = 0;
        this.cancelIdle = scheduleIdle(() => {
          this.cancelIdle = undefined;
          this.callback();
        });
      },
      Math.min(delay, remaining),
    );
  }

  cancel(): void {
    window.clearTimeout(this.timer);
    this.timer = undefined;
    this.cancelIdle?.();
    this.cancelIdle = undefined;
    this.firstPendingAt = 0;
  }
}
