import assert from 'node:assert/strict';
import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS, LIMITS } from '../lib/config/defaults';
import { addStarterCategories, STARTER_CATEGORIES } from '../lib/config/starter-rules';
import { parseSettings } from '../lib/shared/validation';

it('keeps fresh defaults empty and adds editable starter categories on request', () => {
  expect(DEFAULT_SETTINGS.rules).toEqual([]);
  expect(DEFAULT_SETTINGS.categories).toEqual([]);
  const result = addStarterCategories(DEFAULT_SETTINGS);
  expect(result.categories).toEqual(STARTER_CATEGORIES);
  expect(parseSettings({ ...DEFAULT_SETTINGS, ...result })?.categories).toEqual(STARTER_CATEGORIES);
});

it('moves existing starter rules into their groups and preserves custom rules', () => {
  const rules = [
    'Hide sports scores.',
    ...STARTER_CATEGORIES.flatMap((category) => category.rules),
  ];
  const result = addStarterCategories({ rules, categories: [] });
  expect(result.rules).toEqual(['Hide sports scores.']);
  expect(result.categories).toEqual(STARTER_CATEGORIES);
  expect(addStarterCategories(result)).toEqual(result);
  expect(rules.length).toBe(5);
});

it('preserves edited categories and only removes custom rules already covered by the same starter group', () => {
  const ads = STARTER_CATEGORIES[0];
  assert.ok(ads !== undefined);
  const edited = {
    ...ads,
    name: 'Paid placements',
    enabled: false,
    rules: ['Hide promoted links.'],
  };
  const result = addStarterCategories({ rules: ads.rules, categories: [edited] });
  expect(result.categories[0]).toEqual(edited);
  expect(result.rules).toEqual(ads.rules);
});

it('does not add partial categories or exceed the total rule limit', () => {
  const rules = Array.from({ length: LIMITS.rules - 1 }, (_, index) => `Rule ${index}`);
  const result = addStarterCategories({ rules, categories: [] });
  expect(result.rules).toEqual(rules);
  expect(result.categories.map((category) => category.id)).toEqual(['cookie-consent']);
  expect(addStarterCategories(result)).toEqual(result);
});
