/**
 * /docs/[slug] — markdown doc viewer (file-backed).
 *
 * Reads from ~/CascadeProjects/ANT-Docs/<slug>.md. Slug-safety follows
 * the same pattern as /d/<slug>: anchored alphanumeric + ._- only,
 * resolved path must stay inside the docs root.
 *
 * Path is configurable later (per-user vault location, per-room
 * scope) — for the artefact dogfood it's a single global root.
 */

import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const DOCS_ROOT = join(homedir(), 'CascadeProjects', 'ANT-Docs');

export const load: PageServerLoad = async ({ params }) => {
  if (!SLUG_PATTERN.test(params.slug)) throw error(400, 'Invalid doc slug.');

  const filePath = resolve(DOCS_ROOT, `${params.slug}.md`);
  if (!filePath.startsWith(DOCS_ROOT + '/') && filePath !== DOCS_ROOT) {
    throw error(400, 'Path traversal blocked.');
  }

  let raw: string;
  let modifiedAtMs: number | null = null;
  try {
    raw = await readFile(filePath, 'utf8');
    const info = await stat(filePath);
    modifiedAtMs = info.mtimeMs;
  } catch {
    throw error(
      404,
      `Doc "${params.slug}" not found at ${filePath}. Create the markdown file to publish it.`
    );
  }

  return {
    slug: params.slug,
    markdown: raw,
    filePath,
    modifiedAtMs
  };
};
