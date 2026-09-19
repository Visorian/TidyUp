import type {
  CandidateClassification,
  ClassificationResponse,
  ExtensionMessage,
  PublicSettings,
} from '../shared/types';
import { isRecord, parseSettings } from '../shared/validation';
import { browser } from 'wxt/browser';

export async function send(message: ExtensionMessage): Promise<unknown> {
  const response: unknown = await browser.runtime.sendMessage(message);
  return response;
}

interface PageControls {
  readonly status: () => unknown;
  readonly settingsChanged: () => void;
  readonly reveal: () => void;
  readonly rescan: () => void;
}

export function receivePageMessage(
  message: unknown,
  respond: (response: unknown) => void,
  controls: PageControls,
): void {
  if (!isRecord(message)) return;
  switch (message['type']) {
    case 'GET_STATUS':
      respond(controls.status());
      return;
    case 'SETTINGS_CHANGED':
      controls.settingsChanged();
      break;
    case 'REVEAL':
      controls.reveal();
      break;
    case 'RESCAN':
      controls.rescan();
      break;
    default:
      return;
  }
  respond({ ok: true });
}

export function parsePublicSettings(value: unknown): PublicSettings | null {
  if (!isRecord(value) || value['ok'] !== true || typeof value['configured'] !== 'boolean')
    return null;
  const settings = parseSettings(value['settings']);
  return settings === null ? null : { ok: true, settings, configured: value['configured'] };
}

export function parseClassifications(value: unknown): ClassificationResponse {
  if (!isRecord(value)) return { ok: false, error: 'Invalid classifier response.' };
  if (value['ok'] === false && typeof value['error'] === 'string') {
    const delay = value['retryAfterMs'];
    return typeof delay === 'number' && Number.isFinite(delay) && delay > 0
      ? { ok: false, error: value['error'], retryAfterMs: Math.min(300_000, Math.max(1000, delay)) }
      : { ok: false, error: value['error'] };
  }
  if (value['ok'] !== true || !Array.isArray(value['results']) || value['results'].length > 32) {
    return { ok: false, error: 'Invalid classifier response.' };
  }
  const results: CandidateClassification[] = [];
  const ids = new Set<string>();
  for (const result of value['results']) {
    if (
      !isRecord(result) ||
      typeof result['id'] !== 'string' ||
      typeof result['probability'] !== 'number' ||
      !Number.isFinite(result['probability']) ||
      result['probability'] < 0 ||
      result['probability'] > 1 ||
      ids.has(result['id'])
    ) {
      return { ok: false, error: 'Invalid classifier response.' };
    }
    ids.add(result['id']);
    results.push({ id: result['id'], probability: result['probability'] });
  }
  return { ok: true, results };
}
