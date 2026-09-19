import { expect, it, vi } from 'vitest';
import { classify, makeRequest, parseAnswers, PROVIDERS } from '../lib/classifier/client';
import { parseCandidates } from '../lib/classifier/validate';
import type { AdCandidate } from '../lib/shared/types';
import { isRecord } from '../lib/shared/validation';

const candidates: readonly AdCandidate[] = [
  {
    id: 'card_1',
    tag: 'article',
    text: 'Sponsored shoes. Shop now.',
    labels: ['sponsored'],
    linkHosts: ['shop.example.org'],
    pageHost: 'news.example.org',
  },
  {
    id: 'card_2',
    tag: 'aside',
    text: 'A review discussing sponsored posts.',
    labels: ['sponsored'],
    linkHosts: [],
    pageHost: 'news.example.org',
  },
];
const rules = ['Hide paid advertising.', 'Hide subscription offers.'];

function requestBody(value: unknown): unknown {
  if (!isRecord(value) || typeof value['body'] !== 'string')
    throw new Error('No JSON request body');
  const parsed: unknown = JSON.parse(value['body']);
  return parsed;
}

it.each([
  ['typesafe', 'jev-latest'],
  ['openrouter', 'typesafe/jev-1.13'],
] as const)('batches independent Noul decisions through %s', async (provider, modelId) => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        answers: {
          candidate_0_rule_0: { type: 'noul', noul: 0.999 },
          candidate_0_rule_1: { type: 'noul', noul: 0.1 },
          candidate_1_rule_0: { type: 'noul', noul: 0.01 },
          candidate_1_rule_1: { type: 'noul', noul: 0.94 },
        },
      }),
    ),
  );
  await expect(classify(provider, 'test-key', candidates, rules, 'jev')).resolves.toEqual([
    { id: 'card_1', probability: 0.999, ruleProbabilities: [0.999, 0.1] },
    { id: 'card_2', probability: 0.94, ruleProbabilities: [0.01, 0.94] },
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(
    PROVIDERS[provider].endpoint,
    expect.objectContaining({
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
    }),
  );
  const body = requestBody(fetchMock.mock.calls[0]?.[1]);
  expect(body).toMatchObject({
    model: modelId,
    state: { candidates, rules },
    questions: {
      candidate_0_rule_0: { type: 'noul' },
      candidate_0_rule_1: { type: 'noul' },
      candidate_1_rule_0: { type: 'noul' },
      candidate_1_rule_1: { type: 'noul' },
    },
  });
  expect(body).toHaveProperty(
    'questions.candidate_0_rule_0.instructions',
    expect.stringContaining('candidates[0] against rules[0]'),
  );
  expect(body).toHaveProperty(
    'questions.candidate_1_rule_1.instructions',
    expect.stringContaining('candidates[1] against rules[1]'),
  );
});

it.each([undefined, { type: 'noul', noul: 1.1 }, { type: 'noul', noul: '1' }])(
  'rejects the whole batch if one rule decision is invalid or missing',
  (answer: unknown) => {
    const response = {
      answers: {
        candidate_0_rule_0: { type: 'noul', noul: 0.999 },
        candidate_0_rule_1: { type: 'noul', noul: 0.1 },
        candidate_1_rule_0: { type: 'noul', noul: 0.01 },
        candidate_1_rule_1: answer,
      },
    };
    expect(() => parseAnswers(response, candidates, rules)).toThrow(/invalid|missing/u);
  },
);

it('does not contact Jev without user rules', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch');
  await expect(classify('openrouter', 'test-key', candidates, [], 'jev')).resolves.toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('bounds parallel questions before contacting Jev', () => {
  expect(() =>
    makeRequest(
      'openrouter',
      candidates,
      Array.from({ length: 33 }, () => 'Hide subscriptions.'),
      'jev',
    ),
  ).toThrow(/too large/u);
});

it('leaves rate-limited batches undecided and preserves retry-after', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('', { status: 429, headers: { 'retry-after': '60' } }),
  );
  await expect(classify('typesafe', 'test-key', candidates, rules, 'jev')).rejects.toMatchObject({
    retryAfterMs: 60_000,
  });
});

it('rejects oversized or hostile candidate payloads before transmission', () => {
  expect(
    parseCandidates([{ ...candidates[0], text: 'x'.repeat(401) }], 'news.example.org'),
  ).toBeNull();
  expect(
    parseCandidates(
      [{ ...candidates[0], linkHosts: ['shop.example.org/path?token=secret'] }],
      'news.example.org',
    ),
  ).toBeNull();
  expect(parseCandidates([candidates[0], candidates[0]], 'news.example.org')).toBeNull();
  expect(parseCandidates(candidates, 'private.example.org')).toBeNull();
});
