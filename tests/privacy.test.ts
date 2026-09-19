import { expect, it } from 'vitest';
import { safeHost, sanitizeText } from '../lib/candidates/features';
import { DEFAULT_SETTINGS } from '../lib/config/defaults';
import { isPublicHost, isSiteEnabled, parseSettings } from '../lib/shared/validation';

it('reduces destinations to public hostnames and redacts text credentials', () => {
  expect(
    safeHost(
      'https://shop.example.org/account/person?token=secret#session',
      'https://news.example.org',
    ),
  ).toBe('shop.example.org');
  expect(
    sanitizeText(
      'Sponsored. Contact private@example.org or https://shop.example.org/?token=secret. password=hidden-value',
    ),
  ).toBe('Sponsored. Contact [email] or [link] [redacted]');
  expect(safeHost('http://127.0.0.1/private', 'https://news.example.org')).toBeNull();
});

it.each([
  'localhost',
  '127.0.0.1',
  '[::1]',
  'admin.internal',
  'mail.local',
  'intranet',
  'news.example.org/token',
  'news.example.org?secret',
])('does not enable non-public host %s', (host) => {
  expect(isPublicHost(host)).toBe(false);
});

it('does not accept permissive malformed settings from storage or messages', () => {
  expect(
    parseSettings({
      enabled: true,
      disabledSites: ['localhost'],
      provider: 'typesafe',
      threshold: 0.995,
      debug: false,
    }),
  ).toBeNull();
  expect(
    parseSettings({
      enabled: true,
      disabledSites: [],
      provider: 'unknown',
      threshold: 0.995,
      debug: false,
    }),
  ).toBeNull();
  expect(
    parseSettings({
      enabled: true,
      disabledSites: [],
      provider: 'typesafe',
      threshold: Number.NaN,
      debug: false,
    }),
  ).toBeNull();
});

it('allows public sites automatically and respects global and per-site disabling', () => {
  expect(isSiteEnabled(DEFAULT_SETTINGS, 'news.example.org')).toBe(true);
  const settings = { ...DEFAULT_SETTINGS, disabledSites: ['news.example.org'] };
  expect(isSiteEnabled(settings, 'news.example.org')).toBe(false);
  expect(isSiteEnabled(settings, 'another.example.org')).toBe(true);
  expect(isSiteEnabled({ ...DEFAULT_SETTINGS, enabled: false }, 'news.example.org')).toBe(false);
  expect(isSiteEnabled(DEFAULT_SETTINGS, 'localhost')).toBe(false);
});

it('defaults missing exclusions to empty without resetting the saved provider or threshold', () => {
  const saved = { enabled: true, provider: 'openrouter', threshold: 0.94, debug: true };
  expect(parseSettings(saved)).toEqual({
    ...saved,
    model: 'jev',
    activation: 'automatic',
    disabledSites: [],
    rules: [],
    cacheEnabled: true,
    cacheDisabledSites: [],
  });
  expect(parseSettings({ ...saved, disabledSites: null })).toBeNull();
});

it('accepts user rules and cache controls without inserting implicit rules', () => {
  expect(
    parseSettings({
      ...DEFAULT_SETTINGS,
      rules: [' Hide subscriptions. ', 'Hide subscriptions.'],
      cacheEnabled: false,
      cacheDisabledSites: ['news.example.org'],
    }),
  ).toEqual({
    ...DEFAULT_SETTINGS,
    rules: ['Hide subscriptions.'],
    cacheEnabled: false,
    cacheDisabledSites: ['news.example.org'],
  });
  expect(parseSettings(DEFAULT_SETTINGS)?.rules).toEqual([]);
});

it.each([
  { rules: [' '] },
  { rules: ['x'.repeat(501)] },
  { rules: Array.from({ length: 21 }, (_, index) => `Rule ${index}`) },
  { rules: [42] },
  { cacheEnabled: 'false' },
  { cacheDisabledSites: ['localhost'] },
])(
  'rejects malformed or oversized rule/cache settings',
  (invalid: Readonly<Record<string, unknown>>) => {
    expect(parseSettings({ ...DEFAULT_SETTINGS, ...invalid })).toBeNull();
  },
);

it('saves manual activation and rejects unknown activation modes', () => {
  expect(parseSettings({ ...DEFAULT_SETTINGS, activation: 'manual' })?.activation).toBe('manual');
  expect(parseSettings({ ...DEFAULT_SETTINGS, activation: 'sometimes' })).toBeNull();
  expect(parseSettings({ ...DEFAULT_SETTINGS, activation: null })).toBeNull();
});

it('accepts only the supported Jev model in saved settings', () => {
  expect(parseSettings({ ...DEFAULT_SETTINGS, model: 'jev' })?.model).toBe('jev');
  expect(parseSettings({ ...DEFAULT_SETTINGS, model: 'unsupported' })).toBeNull();
  expect(parseSettings({ ...DEFAULT_SETTINGS, model: null })).toBeNull();
});
