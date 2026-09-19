import type { Settings } from '../shared/types';

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  activation: 'automatic',
  provider: 'typesafe',
  model: 'jev',
  disabledSites: [],
  threshold: 0.9,
  debug: false,
  rules: [],
  cacheEnabled: true,
  cacheDisabledSites: [],
};

export const LIMITS = {
  batch: 32,
  rules: 20,
  ruleLength: 500,
  questions: 64,
  queue: 64,
  payloadBytes: 48_000,
  text: 400,
  timeoutMs: 12_000,
  cacheEntries: 256,
} as const;
