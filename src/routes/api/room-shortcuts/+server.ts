import { json } from '@sveltejs/kit';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import type { RequestEvent } from '@sveltejs/kit';

export interface RoomShortcut {
  id: string;
  label: string;
  icon: string;
  sessionId: string;
  color: string;
}

const SHORTCUTS_FILE = join(homedir(), '.ant', 'room-shortcuts.json');

function cleanShortcut(s: any, i: number): RoomShortcut | null {
  if (typeof s.label !== 'string' || typeof s.sessionId !== 'string') return null;
  const label = s.label.trim();
  const sessionId = s.sessionId.trim();
  if (!label || !sessionId) return null;
  return {
    id: typeof s.id === 'string' && s.id.trim() ? s.id.trim() : `room-${i + 1}`,
    label,
    icon: typeof s.icon === 'string' && s.icon.trim() ? s.icon.trim() : '💬',
    sessionId,
    color: typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color.trim())
      ? s.color.trim()
      : '#6366F1',
  };
}

export async function GET() {
  try {
    const raw = await readFile(SHORTCUTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const source = Array.isArray(parsed) ? parsed : parsed?.shortcuts;
    const shortcuts = Array.isArray(source)
      ? source.map(cleanShortcut).filter((s): s is RoomShortcut => s != null)
      : [];
    return json({ shortcuts });
  } catch (err: any) {
    if (err?.code === 'ENOENT') return json({ shortcuts: [] });
    return json({ shortcuts: [], error: 'Invalid room shortcuts config' }, { status: 400 });
  }
}

export async function POST({ request }: RequestEvent) {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, { status: 400 }); }

  const source = Array.isArray(body) ? body : (body as any)?.shortcuts;
  if (!Array.isArray(source)) return json({ error: 'Expected { shortcuts: [...] }' }, { status: 400 });

  const shortcuts = source.map(cleanShortcut).filter((s): s is RoomShortcut => s != null);

  try {
    await mkdir(join(homedir(), '.ant'), { recursive: true });
    await writeFile(SHORTCUTS_FILE, JSON.stringify({ shortcuts }, null, 2), 'utf8');
    return json({ ok: true, shortcuts });
  } catch (err: any) {
    return json({ error: `Failed to save: ${err?.message}` }, { status: 500 });
  }
}
