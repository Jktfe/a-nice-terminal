import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { obsidianVaultPath, maybeWriteSessionSummary } from '$lib/server/capture/obsidian-writer.js';
import { writeOpenSlideDeck } from '$lib/server/capture/open-slide-writer.js';
import { publicOrigin } from '$lib/server/room-invites.js';

const TARGETS = new Set(['obsidian', 'open-slide']);

function openSlideOutputDir(): string {
  const raw = process.env.ANT_OPEN_SLIDE_DIR;
  if (raw && raw.length > 0) return raw;
  return join(homedir(), 'CascadeProjects', 'ANT-Open-Slide');
}

function parseTargets(body: any): string[] {
  const raw = body?.targets ?? body?.target;
  if (!raw) return ['obsidian'];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  const targets = list.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  return targets.length ? targets : ['obsidian'];
}

export function GET() {
  // Probe-on-GET: `configured` reflects whether the receiving target actually
  // exists on disk where the writer would land. Catches the silent-no-op case
  // where a target was assumed installed but the directory is missing.
  const vaultPath = obsidianVaultPath();
  const slidePath = openSlideOutputDir();

  return json({
    targets: [
      {
        id: 'obsidian',
        label: 'Obsidian',
        kind: 'vault',
        description: 'Writes the existing concise markdown session summary into the configured Obsidian vault and memory table.',
        configured: existsSync(vaultPath),
        vault_path: vaultPath,
      },
      {
        id: 'open-slide',
        label: 'Open-Slide',
        kind: 'render',
        description: 'Writes a local Open-Slide-ready React evidence deck bundle from ANT session evidence.',
        configured: existsSync(slidePath),
        output_dir: slidePath,
      },
    ],
  });
}

export async function POST(event: RequestEvent<{ id: string }>) {
  const { params, request } = event;
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const targets = parseTargets(body);
  const unknown = targets.filter((target) => !TARGETS.has(target));
  if (unknown.length) {
    return json({ ok: false, error: `Unknown export target(s): ${unknown.join(', ')}` }, { status: 400 });
  }

  const results: Record<string, unknown> = {};
  if (targets.includes('obsidian')) {
    const path = await maybeWriteSessionSummary(params.id);
    results.obsidian = {
      ok: Boolean(path),
      path,
      vault_path: obsidianVaultPath(),
      skipped: !path,
      note: path ? 'Session summary written to Obsidian and memory table.' : 'No Obsidian file written. Vault may be missing or session may not be learnable.',
    };
  }
  if (targets.includes('open-slide')) {
    const deck = writeOpenSlideDeck(params.id);
    results.open_slide = {
      ...deck,
      deck_page_url: deck.slug ? `${publicOrigin({ url: event.url })}/deck/${deck.slug}` : undefined,
      file_api_url: deck.slug ? `${publicOrigin({ url: event.url })}/api/decks/${deck.slug}/files` : undefined,
    };
  }

  return json({ ok: true, session_id: params.id, targets: results });
}
