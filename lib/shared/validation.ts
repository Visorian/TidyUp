import { LIMITS } from '../config/defaults';
import type { Settings } from './types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPublicHost(host: string): boolean {
  return (
    host.length <= 253 &&
    host.includes('.') &&
    /^[a-z\d](?:[a-z\d.-]*[a-z\d])?$/u.test(host) &&
    !host.includes('..') &&
    !/^\d+(?:\.\d+){3}$/u.test(host) &&
    !/(?:^|\.)(?:localhost|local|internal|intranet|test|invalid|example)$/u.test(host)
  );
}

export function parseSettings(value: unknown): Settings | null {
  if (!isRecord(value)) return null;
  const model = value['model'] === undefined ? 'jev' : value['model'];
  const activation = value['activation'] === undefined ? 'automatic' : value['activation'];
  const disabledSites = parseSites(value['disabledSites']);
  const cacheDisabledSites = parseSites(value['cacheDisabledSites']);
  const rules = parseRules(value['rules']);
  const cacheEnabled = value['cacheEnabled'] === undefined ? true : value['cacheEnabled'];
  if (
    typeof value['enabled'] !== 'boolean' ||
    model !== 'jev' ||
    (activation !== 'automatic' && activation !== 'manual') ||
    (value['provider'] !== 'typesafe' && value['provider'] !== 'openrouter') ||
    typeof value['threshold'] !== 'number' ||
    !Number.isFinite(value['threshold']) ||
    value['threshold'] < 0.9 ||
    value['threshold'] > 1 ||
    typeof value['debug'] !== 'boolean' ||
    disabledSites === null ||
    cacheDisabledSites === null ||
    rules === null ||
    typeof cacheEnabled !== 'boolean'
  ) {
    return null;
  }
  return {
    enabled: value['enabled'],
    activation,
    provider: value['provider'],
    model,
    threshold: value['threshold'],
    debug: value['debug'],
    disabledSites,
    cacheDisabledSites,
    rules,
    cacheEnabled,
  };
}

export function isSiteEnabled(settings: Settings, host: string): boolean {
  return settings.enabled && isPublicHost(host) && !settings.disabledSites.includes(host);
}

function parseSites(value: unknown): readonly string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200) return null;
  const sites: string[] = [];
  for (const host of value) {
    if (typeof host !== 'string' || !isPublicHost(host)) return null;
    sites.push(host);
  }
  return [...new Set(sites)];
}

function parseRules(value: unknown): readonly string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > LIMITS.rules) return null;
  const rules: string[] = [];
  for (const rule of value) {
    if (typeof rule !== 'string' || rule.trim().length === 0 || rule.length > LIMITS.ruleLength)
      return null;
    rules.push(rule.trim());
  }
  return [...new Set(rules)];
}

export function isCacheEnabled(settings: Settings, host: string): boolean {
  return settings.cacheEnabled && !settings.cacheDisabledSites.includes(host);
}
