/**
 * GET /api/skills — server-side manifest of registered ANT skills.
 * Reads static/skills.json (kept in sync with `ant skill list` CLI by hand
 * for v1 — directory-scan vs central registry can land in a follow-up).
 * Powers the Settings → Skills tab per Settings Home design Q5.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

type SkillEntry = { name: string; description: string };
type SkillsManifest = { skills: SkillEntry[] };

let cached: SkillsManifest | null = null;

async function loadManifest(): Promise<SkillsManifest> {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  // build/server/api/skills → ../../../static/skills.json
  // dev (vite)              → cwd-relative static/skills.json
  const paths = [
    resolve(here, '../../../../static/skills.json'),
    resolve(process.cwd(), 'static/skills.json')
  ];
  for (const path of paths) {
    try {
      const raw = await readFile(path, 'utf-8');
      cached = JSON.parse(raw) as SkillsManifest;
      return cached;
    } catch {
      /* try next */
    }
  }
  throw error(500, 'skills manifest not found');
}

export const GET: RequestHandler = async () => {
  const manifest = await loadManifest();
  return json(manifest);
};
