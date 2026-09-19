import { LIMITS } from '../config/defaults';
import type { AdCandidate, CandidateDisplay } from '../shared/types';
import { isPublicHost, isRecord } from '../shared/validation';

function strings(value: unknown, max: number, length: number): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every((item: unknown) => typeof item === 'string' && item.length <= length)
  );
}

function parseDisplay(value: unknown): CandidateDisplay | null {
  if (
    !isRecord(value) ||
    (value['position'] !== 'flow' &&
      value['position'] !== 'fixed' &&
      value['position'] !== 'sticky' &&
      value['position'] !== 'absolute') ||
    (value['shape'] !== 'wide' && value['shape'] !== 'tall' && value['shape'] !== 'box') ||
    typeof value['frames'] !== 'number' ||
    !Number.isInteger(value['frames']) ||
    value['frames'] < 0 ||
    value['frames'] > 80 ||
    typeof value['images'] !== 'number' ||
    !Number.isInteger(value['images']) ||
    value['images'] < 0 ||
    value['images'] > 80 ||
    typeof value['backgroundImage'] !== 'boolean' ||
    typeof value['labelOnly'] !== 'boolean'
  )
    return null;
  return {
    position: value['position'],
    shape: value['shape'],
    frames: value['frames'],
    images: value['images'],
    backgroundImage: value['backgroundImage'],
    labelOnly: value['labelOnly'],
  };
}

export function parseCandidates(value: unknown, pageHost: string): readonly AdCandidate[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > LIMITS.batch) return null;
  const result: AdCandidate[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item['id'] !== 'string' ||
      !/^[a-z\d_-]{1,64}$/iu.test(item['id']) ||
      ids.has(item['id']) ||
      typeof item['tag'] !== 'string' ||
      !/^[a-z][a-z\d-]{0,30}$/u.test(item['tag']) ||
      typeof item['text'] !== 'string' ||
      item['text'].length > LIMITS.text ||
      item['pageHost'] !== pageHost ||
      !strings(item['labels'], 12, 40) ||
      !strings(item['linkHosts'], 8, 253) ||
      !item['linkHosts'].every(isPublicHost) ||
      (item['descriptions'] !== undefined && !strings(item['descriptions'], 2, 96))
    )
      return null;
    const display = item['display'] === undefined ? undefined : parseDisplay(item['display']);
    if (display === null) return null;
    ids.add(item['id']);
    result.push({
      id: item['id'],
      tag: item['tag'],
      text: item['text'],
      pageHost,
      labels: item['labels'],
      linkHosts: item['linkHosts'],
      ...(item['descriptions'] === undefined ? {} : { descriptions: item['descriptions'] }),
      ...(display === undefined ? {} : { display }),
    });
  }
  return result;
}
