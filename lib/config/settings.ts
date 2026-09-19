import { browser } from 'wxt/browser';
import type { Provider, PublicSettings, Settings } from '../shared/types';
import { isRecord, parseSettings } from '../shared/validation';
import { DEFAULT_SETTINGS } from './defaults';

export async function readSettings(): Promise<Settings> {
  const stored: unknown = await browser.storage.local.get('settings');
  return isRecord(stored)
    ? (parseSettings(stored['settings']) ?? DEFAULT_SETTINGS)
    : DEFAULT_SETTINGS;
}

export async function readKey(provider: Provider): Promise<string> {
  const stored: unknown = await browser.storage.local.get(`key:${provider}`);
  if (!isRecord(stored)) return '';
  const key = stored[`key:${provider}`];
  return typeof key === 'string' ? key : '';
}

export async function publicSettings(): Promise<PublicSettings> {
  const settings = await readSettings();
  return { ok: true, settings, configured: (await readKey(settings.provider)).length > 0 };
}

export async function restrictStorage(): Promise<void> {
  if (import.meta.env.CHROME) {
    await browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  }
}
