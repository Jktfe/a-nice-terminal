import { json } from '@sveltejs/kit';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import type { RequestEvent } from '@sveltejs/kit';
import {
  SHORTCUT_SCOPES,
  createDefaultPersonalSettings,
  type PersonalSettings,
  type PersonalShortcut,
  type ShortcutScope,
} from '$lib/shared/personal-settings';

const SETTINGS_FILE = process.env.ANT_PERSONAL_SETTINGS_FILE
  || join(homedir(), '.ant', 'personal-settings.json');
const LEGACY_SHORTCUTS_FILE = join(homedir(), '.ant', 'room-shortcuts.json');

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cleanShortcut(value: unknown, index: number): PersonalShortcut | null {
  if (!isObject(value)) return null;
  if (typeof value.label !== 'string' || typeof value.sessionId !== 'string') return null;

  const label = value.label.trim();
  const sessionId = value.sessionId.trim();
  if (!label || !sessionId) return null;

  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id.trim() : `shortcut-${index + 1}`,
    label,
    icon: typeof value.icon === 'string' && value.icon.trim() ? value.icon.trim() : '*',
    sessionId,
    color: typeof value.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color.trim())
      ? value.color.trim()
      : '#6366F1',
  };
}

function cleanShortcutList(value: unknown): PersonalShortcut[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(cleanShortcut)
    .filter((shortcut): shortcut is PersonalShortcut => shortcut != null);
}

function normaliseSettings(value: unknown): PersonalSettings {
  const settings = createDefaultPersonalSettings();
  if (!isObject(value)) return settings;

  const shortcuts = isObject(value.shortcuts) ? value.shortcuts : {};
  for (const scope of SHORTCUT_SCOPES) {
    settings.shortcuts[scope] = cleanShortcutList(shortcuts[scope]);
  }

  settings.preferences = isObject(value.preferences) ? value.preferences : {};
  return settings;
}

async function loadLegacyShortcuts(): Promise<PersonalShortcut[]> {
  try {
    const raw = await readFile(LEGACY_SHORTCUTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const source = Array.isArray(parsed) ? parsed : parsed?.shortcuts;
    return cleanShortcutList(source);
  } catch {
    return [];
  }
}

async function readSettings(): Promise<PersonalSettings> {
  try {
    const raw = await readFile(SETTINGS_FILE, 'utf8');
    return normaliseSettings(JSON.parse(raw));
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }

  const settings = createDefaultPersonalSettings();
  settings.shortcuts.chatrooms = await loadLegacyShortcuts();
  return settings;
}

function writeableSettings(settings: PersonalSettings): PersonalSettings {
  return {
    shortcuts: SHORTCUT_SCOPES.reduce((acc, scope) => {
      acc[scope] = settings.shortcuts[scope] ?? [];
      return acc;
    }, {} as Record<ShortcutScope, PersonalShortcut[]>),
    preferences: settings.preferences ?? {},
  };
}

export async function GET() {
  try {
    const settings = await readSettings();
    return json({ settings, path: SETTINGS_FILE });
  } catch (err: any) {
    return json({ settings: createDefaultPersonalSettings(), error: `Invalid personal settings: ${err?.message}` }, { status: 400 });
  }
}

export async function POST({ request }: RequestEvent) {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, { status: 400 }); }

  const source = isObject(body) && 'settings' in body ? body.settings : body;
  const settings = writeableSettings(normaliseSettings(source));

  try {
    await mkdir(join(homedir(), '.ant'), { recursive: true });
    await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    return json({ ok: true, settings, path: SETTINGS_FILE });
  } catch (err: any) {
    return json({ error: `Failed to save: ${err?.message}` }, { status: 500 });
  }
}
