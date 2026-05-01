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

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cleanShortcut(value: unknown, index: number): PersonalShortcut | null {
  if (!isObject(value)) return null;
  if (typeof value.label !== 'string' || typeof value.command !== 'string') return null;

  const label = value.label.trim();
  const command = value.command;
  if (!label || !command) return null;

  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id.trim() : `shortcut-${index + 1}`,
    label,
    icon: typeof value.icon === 'string' && value.icon.trim() ? value.icon.trim() : '⚡',
    command,
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

function normaliseSettings(value: unknown, fallbackSeeds = false): PersonalSettings {
  const settings = createDefaultPersonalSettings();
  if (!isObject(value)) return settings;

  const shortcuts = isObject(value.shortcuts) ? value.shortcuts : null;
  if (shortcuts) {
    for (const scope of SHORTCUT_SCOPES) {
      // Replace seeds when the on-disk record explicitly contains a `shortcuts`
      // object — even an empty array — so users can clear their list.
      settings.shortcuts[scope] = cleanShortcutList(shortcuts[scope]);
    }
  } else if (!fallbackSeeds) {
    for (const scope of SHORTCUT_SCOPES) settings.shortcuts[scope] = [];
  }

  settings.preferences = isObject(value.preferences) ? value.preferences : {};
  return settings;
}

async function readSettings(): Promise<PersonalSettings> {
  try {
    const raw = await readFile(SETTINGS_FILE, 'utf8');
    return normaliseSettings(JSON.parse(raw));
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }

  // No on-disk settings yet → seed with starter chips.
  return createDefaultPersonalSettings();
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
