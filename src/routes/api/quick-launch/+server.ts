import { json } from '@sveltejs/kit';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

type LocalQuickLaunchButton = {
  id?: unknown;
  label?: unknown;
  icon?: unknown;
  command?: unknown;
  color?: unknown;
};

const DEFAULT_QUICK_LAUNCH_FILE = join(homedir(), '.ant', 'quick-launch.json');

function cleanButton(button: LocalQuickLaunchButton, index: number) {
  if (typeof button.label !== 'string' || typeof button.command !== 'string') return null;

  const label = button.label.trim();
  const command = button.command.trim();
  if (!label || !command) return null;

  return {
    id: typeof button.id === 'string' && button.id.trim() ? button.id.trim() : `local-${index + 1}`,
    label,
    icon: typeof button.icon === 'string' && button.icon.trim() ? button.icon.trim() : '*',
    command,
    color: typeof button.color === 'string' && /^#[0-9a-f]{6}$/i.test(button.color.trim())
      ? button.color.trim()
      : '#6366F1',
  };
}

export async function GET() {
  const file = process.env.ANT_QUICK_LAUNCH_FILE || DEFAULT_QUICK_LAUNCH_FILE;

  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    const source = Array.isArray(parsed) ? parsed : parsed?.buttons;
    const buttons = Array.isArray(source)
      ? source.map(cleanButton).filter((button): button is NonNullable<typeof button> => button != null)
      : [];

    return json({ buttons });
  } catch (err: any) {
    if (err?.code === 'ENOENT') return json({ buttons: [] });
    return json({ buttons: [], error: 'Invalid local quick launch config' }, { status: 400 });
  }
}
