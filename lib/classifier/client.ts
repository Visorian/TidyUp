import { LIMITS } from '../config/defaults';
import type { AdCandidate, CandidateClassification, Model, Provider } from '../shared/types';
import { isRecord } from '../shared/validation';
import { RULE_INSTRUCTIONS } from './policy';

export const PROVIDERS = {
  typesafe: { endpoint: 'https://api.typesafe.ai/v1/systemone', models: { jev: 'jev-latest' } },
  openrouter: {
    endpoint: 'https://openrouter.ai/api/alpha/decisions',
    models: { jev: 'typesafe/jev-1.13' },
  },
} as const;

export class ServiceError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs = 30_000) {
    super(message);
    this.name = 'ServiceError';
    this.retryAfterMs = retryAfterMs;
  }
}

export function makeRequest(
  provider: Provider,
  candidates: readonly AdCandidate[],
  rules: readonly string[],
  model: Model,
): string {
  if (rules.length === 0 || candidates.length * rules.length > LIMITS.questions)
    throw new ServiceError('The rule evaluation batch is empty or too large.', 0);
  const questions = Object.fromEntries(
    candidates.flatMap((_candidate, candidateIndex) =>
      rules.map((_rule, ruleIndex) => [
        questionId(candidateIndex, ruleIndex),
        {
          type: 'noul',
          instructions: `${RULE_INSTRUCTIONS} Evaluate candidates[${candidateIndex}] against rules[${ruleIndex}].`,
        },
      ]),
    ),
  );
  const body = JSON.stringify({
    model: PROVIDERS[provider].models[model],
    state: { candidates, rules },
    questions,
  });
  if (new TextEncoder().encode(body).byteLength > LIMITS.payloadBytes)
    throw new ServiceError('The candidate batch is too large.', 0);
  return body;
}

function questionId(candidateIndex: number, ruleIndex: number): string {
  return `candidate_${candidateIndex}_rule_${ruleIndex}`;
}

function readProbability(value: unknown): number {
  if (
    !isRecord(value) ||
    value['type'] !== 'noul' ||
    typeof value['noul'] !== 'number' ||
    !Number.isFinite(value['noul']) ||
    value['noul'] < 0 ||
    value['noul'] > 1
  )
    throw new ServiceError('The service returned an invalid or missing probability.');
  return value['noul'];
}

export function parseAnswers(
  value: unknown,
  candidates: readonly AdCandidate[],
  rules: readonly string[],
): readonly CandidateClassification[] {
  if (!isRecord(value) || !isRecord(value['answers']))
    throw new ServiceError('The service returned an invalid decision response.');
  const answers = value['answers'];
  return candidates.map(({ id }, candidateIndex) => {
    const ruleProbabilities = rules.map((_rule, ruleIndex) =>
      readProbability(answers[questionId(candidateIndex, ruleIndex)]),
    );
    return { id, probability: Math.max(0, ...ruleProbabilities), ruleProbabilities };
  });
}

export async function classify(
  provider: Provider,
  apiKey: string,
  candidates: readonly AdCandidate[],
  rules: readonly string[],
  model: Model,
): Promise<readonly CandidateClassification[]> {
  if (rules.length === 0 || candidates.length === 0) return [];
  const requestBody = makeRequest(provider, candidates, rules, model);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, LIMITS.timeoutMs);
  try {
    const response = await fetch(PROVIDERS[provider].endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: requestBody,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw responseError(response.status, response.headers.get('retry-after'));
    const body = await response.text();
    if (body.length > 64_000)
      throw new ServiceError('The service response exceeds the size limit.');
    const parsed: unknown = JSON.parse(body);
    return parseAnswers(parsed, candidates, rules);
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(
      controller.signal.aborted
        ? 'The service timed out. Content was left visible.'
        : 'Could not reach the service or read its response. Content was left visible.',
    );
  } finally {
    clearTimeout(timeout);
  }
}

function responseError(status: number, retryAfter: string | null): ServiceError {
  const retrySeconds = Number(retryAfter);
  const retryMs =
    Number.isFinite(retrySeconds) && retrySeconds > 0
      ? Math.min(retrySeconds * 1000, 300_000)
      : 30_000;
  return new ServiceError(
    `Service returned HTTP ${status}. Check your key, access, and quota.`,
    retryMs,
  );
}
