import { expect, it } from 'vitest';
import { activeRules } from '../lib/config/categories';
import { DEFAULT_SETTINGS } from '../lib/config/defaults';
import type { Settings } from '../lib/shared/types';
import { parseClassifications } from '../lib/runtime/messages';
import { parseSettings } from '../lib/shared/validation';

const ads = { id: 'ads', name: 'Ads', enabled: true, rules: ['Hide paid advertising.'] };

it('keeps existing custom rules and provider settings when categories are absent', () => {
  const { categories: _categories, ...settings } = DEFAULT_SETTINGS;
  const stored = { ...settings, provider: 'openrouter', rules: ['Hide recipes.'], threshold: 0.96 };
  expect(parseSettings(stored)).toEqual({ ...stored, categories: [] });
});

it('normalizes rules within groups and preserves shared rules across groups for attribution', () => {
  const settings = requireSettings({
    ...DEFAULT_SETTINGS,
    rules: ['Hide recipes.'],
    categories: [
      { ...ads, name: ' Ads ', rules: [' Hide paid advertising. ', 'Hide paid advertising.'] },
      { id: 'sponsors', name: 'Sponsors', enabled: true, rules: ads.rules },
      { id: 'cookies', name: 'Cookies', enabled: false, rules: ['Hide cookie banners.'] },
    ],
  });
  expect(settings.categories[0]?.name).toBe('Ads');
  expect(activeRules(settings)).toEqual([
    { text: 'Hide recipes.', categoryId: null },
    { text: 'Hide paid advertising.', categoryId: 'ads' },
    { text: 'Hide paid advertising.', categoryId: 'sponsors' },
  ]);
});

it.each(
  [
    [{ ...ads, id: '__proto__' }],
    [{ ...ads, id: 'a'.repeat(65) }],
    [ads, ads],
    [{ ...ads, name: ' ' }],
    [{ ...ads, name: 'a'.repeat(61) }],
    [{ ...ads, enabled: 'true' }],
    [{ ...ads, rules: [' '] }],
    Array.from({ length: 21 }, (_, index) => ({ ...ads, id: `category-${index}`, rules: [] })),
  ].map((categories: readonly unknown[]) => ({ categories })),
)('rejects malformed category settings', ({ categories }: { readonly categories: unknown }) => {
  expect(parseSettings({ ...DEFAULT_SETTINGS, categories })).toBeNull();
});

it('bounds the total stored rules across custom and disabled categories', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    rules: ['Custom rule'],
    categories: [
      { ...ads, enabled: false, rules: Array.from({ length: 20 }, (_, index) => `Rule ${index}`) },
    ],
  };
  expect(parseSettings(settings)).toBeNull();
  expect(parseSettings({ ...settings, rules: [] })).not.toBeNull();
});

it.each([
  { probability: 0.99 },
  { probability: 0.99, ruleProbabilities: [] },
  { probability: 0.99, ruleProbabilities: [0.98] },
  { probability: 0.99, ruleProbabilities: [0.99, Number.NaN] },
])(
  'rejects decisions without valid per-rule evidence',
  (decision: Readonly<{ probability: number; ruleProbabilities?: readonly number[] }>) => {
    expect(parseClassifications({ ok: true, results: [{ id: 'candidate', ...decision }] }).ok).toBe(
      false,
    );
  },
);

function requireSettings(value: unknown): Settings {
  const settings = parseSettings(value);
  if (settings === null) throw new Error('Expected valid categories');
  return settings;
}
