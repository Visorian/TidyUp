import { LIMITS } from '../config/defaults';
import type { RuleCategory, Settings } from './types';

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
  const categories = parseCategories(value['categories']);
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
    categories === null ||
    rules.length + categories.reduce((count, category) => count + category.rules.length, 0) >
      LIMITS.rules ||
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
    categories,
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

export function isCategoryId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/u.test(value);
}

function parseCategories(value: unknown): readonly RuleCategory[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > LIMITS.rules) return null;
  const categories: RuleCategory[] = [];
  const ids = new Set<string>();
  for (const category of value) {
    if (
      !isRecord(category) ||
      typeof category['id'] !== 'string' ||
      !isCategoryId(category['id']) ||
      ids.has(category['id']) ||
      typeof category['name'] !== 'string' ||
      category['name'].trim().length === 0 ||
      category['name'].trim().length > 60 ||
      typeof category['enabled'] !== 'boolean'
    )
      return null;
    const rules = parseRules(category['rules']);
    if (rules === null) return null;
    ids.add(category['id']);
    categories.push({
      id: category['id'],
      name: category['name'].trim(),
      enabled: category['enabled'],
      rules,
    });
  }
  return categories;
}

export function parseRuleProbabilities(value: unknown): readonly number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > LIMITS.rules) return null;
  const probabilities: number[] = [];
  for (const probability of value) {
    if (
      typeof probability !== 'number' ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    )
      return null;
    probabilities.push(probability);
  }
  return probabilities;
}
