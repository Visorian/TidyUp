import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS, LIMITS } from '../lib/config/defaults';
import { addStarterRules, STARTER_RULES } from '../lib/config/starter-rules';
import { parseSettings } from '../lib/shared/validation';

it('keeps defaults empty and creates valid settings when starter rules are selected', () => {
  const rules = addStarterRules(DEFAULT_SETTINGS.rules);
  expect(DEFAULT_SETTINGS.rules).toEqual([]);
  expect(rules).toEqual(STARTER_RULES);
  expect(parseSettings({ ...DEFAULT_SETTINGS, rules })?.rules).toEqual(rules);
});

it('preserves existing rules and adds each starter only once', () => {
  const existing = ['Hide newsletter prompts.', ...STARTER_RULES.slice(0, 1)];
  const rules = addStarterRules(existing);
  expect(rules).toEqual(['Hide newsletter prompts.', ...STARTER_RULES]);
  expect(addStarterRules(rules)).toEqual(rules);
  expect(existing).toEqual(['Hide newsletter prompts.', ...STARTER_RULES.slice(0, 1)]);
});

it('fills available slots without dropping existing rules or exceeding the limit', () => {
  const existing = Array.from({ length: LIMITS.rules - 1 }, (_, index) => `Rule ${index}`);
  const rules = addStarterRules(existing);
  expect(rules).toEqual([...existing, ...STARTER_RULES.slice(0, 1)]);
  expect(addStarterRules(rules)).toEqual(rules);
  const afterRemoval = rules.filter((rule) => rule !== 'Rule 0');
  expect(addStarterRules(afterRemoval)).toEqual([...afterRemoval, ...STARTER_RULES.slice(1, 2)]);
});
