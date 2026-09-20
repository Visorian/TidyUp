import { expect, it } from 'vitest';
import { candidateFingerprint } from '../lib/candidates/fingerprint';
import { parseCandidates } from '../lib/classifier/validate';
import type { AdCandidate } from '../lib/shared/types';

const candidate: AdCandidate = {
  id: 'region-1',
  tag: 'div',
  text: 'Cookie consent',
  labels: ['consent overlay'],
  linkHosts: ['cmp.example.org'],
  pageHost: 'news.example.org',
};

it.each(['overlay', 'background'] as const)('preserves supported %s candidate kinds', (kind) => {
  const specialized = { ...candidate, kind };
  expect(parseCandidates([specialized], candidate.pageHost)).toEqual([specialized]);
  expect(candidateFingerprint(specialized)).not.toBe(candidateFingerprint(candidate));
});

it.each(['consent', 'dialog', 'advertisement', '', null, 1])(
  'rejects an unknown candidate kind %s',
  (kind) => {
    expect(parseCandidates([{ ...candidate, kind }], candidate.pageHost)).toBeNull();
  },
);

it('keeps ordinary candidates valid and separates overlay from background decisions', () => {
  expect(parseCandidates([candidate], candidate.pageHost)).toEqual([candidate]);
  expect(candidateFingerprint({ ...candidate, kind: 'overlay' })).not.toBe(
    candidateFingerprint({ ...candidate, kind: 'background' }),
  );
});
