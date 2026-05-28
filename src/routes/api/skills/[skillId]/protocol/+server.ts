/**
 * /api/skills/[skillId]/protocol — agent-facing skill protocol fetch.
 *
 * Per the corrected architecture (JWPK eiw05zdurz msg_pgp1n75ufb +
 * msg_o1e307juug 2026-05-28):
 *
 * Agents asked to perform a skill (e.g. ANT validation tagging,
 * create-verification-lens) PULL the protocol on demand. ANT doesn't
 * push prompts to agents; agents self-service from the skill registry
 * or memory.
 *
 * This endpoint surfaces the protocol — the markdown doc agents read
 * to know how to do the work. The protocol files live in
 * `docs/specs/` in the repo; this endpoint serves them over HTTP so
 * remote agents (mobile, cloud-hosted, etc) can fetch without
 * filesystem access.
 *
 * Read-only, no auth (skill protocols are public per the substrate
 * trust-surface model — they're documentation, not credentials).
 *
 * Discovery: GET /api/skills lists available skills.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Map skill_id → protocol file path(s) under docs/specs/.
// Adding a new skill = adding a row here + dropping the protocol doc.
// Each skill MAY have multiple files (e.g. a spec doc + a prompt template).
const SKILL_REGISTRY: Record<string, { files: string[]; description: string }> = {
  'create-verification-lens': {
    files: [
      'docs/specs/create-verification-lens-skill.md',
      'docs/specs/create-verification-lens-prompt-template.md'
    ],
    description:
      'Translate plain-English requirements into a concrete verification lens spec. Agent produces a SkillSuccessOutput JSON; substrate parses + persists via POST /api/verification/lenses + POST .../tag-rows.'
  }
  // Future skills: 'ant-validation-tagging', 'verify-claim-against-lens', etc.
};

function repoRoot(): string {
  // server.ts compiles into .svelte-kit/output; walk up to find the project root.
  // Use a deterministic anchor: look for package.json.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  // Fallback to cwd
  return process.cwd();
}

export const GET: RequestHandler = async ({ params }) => {
  const skillId = params.skillId;
  if (!skillId) throw error(400, 'skillId required');
  const entry = SKILL_REGISTRY[skillId];
  if (!entry) throw error(404, `skill "${skillId}" not in registry`);

  const root = repoRoot();
  const files: Array<{ path: string; content: string }> = [];
  for (const relPath of entry.files) {
    const fullPath = join(root, relPath);
    if (!existsSync(fullPath)) {
      throw error(500, `skill ${skillId} references missing file: ${relPath}`);
    }
    try {
      const content = readFileSync(fullPath, 'utf8');
      files.push({ path: relPath, content });
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      throw error(500, `failed to read ${relPath}: ${msg}`);
    }
  }
  return json({
    skill_id: skillId,
    description: entry.description,
    files
  });
};
