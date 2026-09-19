import { expect, it, vi } from 'vitest';
import { parseClassifications } from '../lib/runtime/messages';

vi.mock('wxt/browser', () => ({ browser: {} }));

it('preserves service cooldowns within safe timer bounds', () => {
  expect(parseClassifications({ ok: false, error: 'Busy', retryAfterMs: 30_000 })).toEqual({
    ok: false,
    error: 'Busy',
    retryAfterMs: 30_000,
  });
  expect(parseClassifications({ ok: false, error: 'Busy', retryAfterMs: 1 })).toHaveProperty(
    'retryAfterMs',
    1000,
  );
  expect(
    parseClassifications({ ok: false, error: 'Busy', retryAfterMs: 1_000_000 }),
  ).toHaveProperty('retryAfterMs', 300_000);
});

it.each([undefined, '1000', -1, Number.NaN, Number.POSITIVE_INFINITY])(
  'does not automatically retry an absent or invalid cooldown: %s',
  (retryAfterMs: unknown) => {
    expect(parseClassifications({ ok: false, error: 'Unavailable', retryAfterMs })).toEqual({
      ok: false,
      error: 'Unavailable',
    });
  },
);
