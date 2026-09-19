export type ActivationMode = 'automatic' | 'manual';

export type Model = 'jev';

export type Provider = 'typesafe' | 'openrouter';

export interface RuleCategory {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly rules: readonly string[];
}

export interface Settings {
  readonly enabled: boolean;
  readonly activation: ActivationMode;
  readonly provider: Provider;
  readonly model: Model;
  readonly disabledSites: readonly string[];
  readonly threshold: number;
  readonly debug: boolean;
  readonly rules: readonly string[];
  readonly categories: readonly RuleCategory[];
  readonly cacheEnabled: boolean;
  readonly cacheDisabledSites: readonly string[];
}

export interface PublicSettings {
  readonly ok: true;
  readonly settings: Settings;
  readonly configured: boolean;
}

export interface AdCandidate {
  readonly id: string;
  readonly kind?: 'consent' | 'background' | 'ad-slot';
  readonly tag: string;
  readonly text: string;
  readonly labels: readonly string[];
  readonly linkHosts: readonly string[];
  readonly pageHost: string;
  readonly descriptions?: readonly string[];
  readonly display?: CandidateDisplay;
}

export interface CandidateDisplay {
  readonly position: 'flow' | 'fixed' | 'sticky' | 'absolute';
  readonly shape: 'wide' | 'tall' | 'box';
  readonly frames: number;
  readonly images: number;
  readonly backgroundImage: boolean;
  readonly labelOnly: boolean;
}

export interface CandidateClassification {
  readonly id: string;
  readonly probability: number;
  readonly ruleProbabilities: readonly number[];
}

export interface PageMetrics {
  readonly scanned: number;
  readonly candidates: number;
  readonly sent: number;
  readonly hidden: number;
  readonly restored: number;
  readonly dropped: number;
  readonly cacheHits: number;
  readonly queued: number;
  readonly latencyMs: number;
}

export interface PageStatus {
  readonly host: string;
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly waitingForActivation: boolean;
  readonly error: string;
  readonly metrics: PageMetrics;
  readonly hiddenByCategory: Readonly<Record<string, number>>;
}

export type ExtensionMessage =
  | { readonly type: 'GET_SETTINGS' }
  | {
      readonly type: 'SAVE_SETTINGS';
      readonly settings: Settings;
      readonly apiKey?: string;
      readonly clearKey?: boolean;
    }
  | { readonly type: 'SET_SITE'; readonly host: string; readonly enabled: boolean }
  | { readonly type: 'SET_SITE_CACHE'; readonly host: string; readonly enabled: boolean }
  | { readonly type: 'CLEAR_CACHE'; readonly host?: string }
  | { readonly type: 'TEST_CONNECTION' }
  | {
      readonly type: 'CLASSIFY';
      readonly pageHost: string;
      readonly generation: number;
      readonly candidates: readonly AdCandidate[];
    }
  | {
      readonly type: 'LOOKUP_CACHE';
      readonly pageHost: string;
      readonly generation: number;
      readonly candidates: readonly AdCandidate[];
    }
  | { readonly type: 'GET_REPLAY'; readonly pageHost: string; readonly generation: number }
  | {
      readonly type: 'REMEMBER_REGION';
      readonly pageHost: string;
      readonly generation: number;
      readonly candidates: readonly AdCandidate[];
      readonly selector: string;
      readonly slotFingerprint?: string;
      readonly epoch: string;
    }
  | { readonly type: 'SETTINGS_CHANGED' }
  | { readonly type: 'GET_STATUS' }
  | { readonly type: 'REVEAL' }
  | { readonly type: 'HIDE_AGAIN' }
  | { readonly type: 'RESCAN' };

export type ClassificationResponse =
  | { readonly ok: true; readonly results: readonly CandidateClassification[] }
  | { readonly ok: false; readonly error: string; readonly retryAfterMs?: number };
