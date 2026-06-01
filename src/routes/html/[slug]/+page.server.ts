/**
 * /html/[slug] — sandboxed HTML artefact viewer (file-backed).
 *
 * Reads from ~/CascadeProjects/ANT-HTML/<slug>.html. Renders inside a
 * sandboxed iframe with srcdoc so the artefact's scripts, if any, run
 * in an origin-isolated context and can't reach back into v4's page.
 *
 * Safe-mode CSP: scripts only run if explicitly trusted (future flag);
 * default no-scripts.
 */

import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const HTML_ROOT = join(homedir(), 'CascadeProjects', 'ANT-HTML');

export const load: PageServerLoad = async ({ params }) => {
  if (!SLUG_PATTERN.test(params.slug)) throw error(400, 'Invalid html slug.');

  const filePath = resolve(HTML_ROOT, `${params.slug}.html`);
  if (!filePath.startsWith(HTML_ROOT + '/') && filePath !== HTML_ROOT) {
    throw error(400, 'Path traversal blocked.');
  }

  let body: string;
  let modifiedAtMs: number | null = null;
  try {
    body = await readFile(filePath, 'utf8');
    const info = await stat(filePath);
    modifiedAtMs = info.mtimeMs;
  } catch {
    throw error(
      404,
      `HTML artefact "${params.slug}" not found at ${filePath}.`
    );
  }

  return {
    slug: params.slug,
    body,
    filePath,
    modifiedAtMs,
    sizeBytes: body.length
  };
};
