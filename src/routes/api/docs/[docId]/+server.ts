// ANT — Shared Doc CRUD + section management
// Each doc is a memory key (docs/{docId}), sections are sub-keys (docs/{docId}/sections/{sectionId})

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DOC_PREFIX = 'docs/';
const OBSIDIAN_ANT = process.env.ANT_OBSIDIAN_VAULT || join(homedir(), 'CascadeProjects', 'ObsidiANT');
const DOCS_DIR = join(OBSIDIAN_ANT, 'research');

function mirrorToObsidian(docId: string, meta: any, markdown: string) {
  if (!existsSync(OBSIDIAN_ANT)) return;
  mkdirSync(DOCS_DIR, { recursive: true });
  const frontmatter = [
    '---',
    `doc_id: ${docId}`,
    `title: "${meta.title || docId}"`,
    `status: ${meta.status || 'draft'}`,
    `authors: [${(meta.authors || []).join(', ')}]`,
    `sign_offs: [${(meta.signOffs || []).join(', ')}]`,
    `updated_at: ${new Date().toISOString()}`,
    '---',
  ].join('\n');
  writeFileSync(join(DOCS_DIR, `${docId}.md`), `${frontmatter}\n\n${markdown}`, 'utf-8');
}

/** Re-render and mirror a doc to Obsidian after any update */
function refreshObsidianMirror(docId: string) {
  const docKey = DOC_PREFIX + docId;
  const docRow = queries.getMemoryByKey(docKey) as any;
  if (!docRow) return;
  let meta: any = {};
  try { meta = JSON.parse(docRow.value || '{}'); } catch {}
  const sectionPrefix = docKey + '/sections/';
  const sectionRows = queries.listMemoriesByPrefix(sectionPrefix, 200) as any[];
  const lines: string[] = [];
  lines.push(`# ${meta.title || docId}`);
  if (meta.description) lines.push(`\n> ${meta.description}`);
  lines.push(`\n**Status:** ${meta.status || 'draft'} | **Authors:** ${(meta.authors || []).join(', ') || 'none'}`);
  lines.push('');
  for (const r of sectionRows) {
    let s: any = {};
    try { s = JSON.parse(r.value || '{}'); } catch {}
    lines.push(`## ${s.heading || r.key}`);
    lines.push(`*Author: ${s.author || 'unknown'}${s.signedOff ? ' ✓ signed off' : ''}*\n`);
    lines.push(s.content || '');
    lines.push('');
  }
  mirrorToObsidian(docId, meta, lines.join('\n'));
}

/** Get a doc with all its sections, rendered as a single markdown document */
export function GET({ params }: RequestEvent) {
  const docId = params.docId!;
  const docKey = DOC_PREFIX + docId;
  const docRow = queries.getMemoryByKey(docKey) as any;
  if (!docRow) throw error(404, 'Doc not found');

  let meta: any = {};
  try { meta = JSON.parse(docRow.value || '{}'); } catch {}

  // Fetch all sections
  const sectionPrefix = docKey + '/sections/';
  const sectionRows = queries.listMemoriesByPrefix(sectionPrefix, 200) as any[];

  const sections = sectionRows.map((r: any) => {
    const sectionId = r.key?.replace(sectionPrefix, '') || '';
    let sectionMeta: any = {};
    try { sectionMeta = JSON.parse(r.value || '{}'); } catch { sectionMeta = { content: r.value }; }
    return {
      id: sectionId,
      heading: sectionMeta.heading || sectionId,
      content: sectionMeta.content || '',
      author: sectionMeta.author || r.created_by || 'unknown',
      signedOff: sectionMeta.signedOff || false,
      updated_at: r.updated_at,
    };
  });

  // Render as markdown
  const lines: string[] = [];
  lines.push(`# ${meta.title || params.docId!}`);
  if (meta.description) lines.push(`\n> ${meta.description}`);
  lines.push(`\n**Status:** ${meta.status || 'draft'} | **Authors:** ${(meta.authors || []).join(', ') || 'none'}`);
  lines.push('');

  for (const s of sections) {
    lines.push(`## ${s.heading}`);
    lines.push(`*Author: ${s.author}${s.signedOff ? ' ✓ signed off' : ''}*\n`);
    lines.push(s.content);
    lines.push('');
  }

  const markdown = lines.join('\n');

  // Mirror to Obsidian vault for mobile viewing
  mirrorToObsidian(params.docId!, meta, markdown);

  return json({
    id: params.docId!,
    title: meta.title,
    status: meta.status || 'draft',
    authors: meta.authors || [],
    sections,
    markdown,
  });
}

/** Update doc metadata or add/update a section */
export async function PUT({ params, request }: RequestEvent) {
  const docKey = DOC_PREFIX + params.docId!;
  const docRow = queries.getMemoryByKey(docKey) as any;
  if (!docRow) throw error(404, 'Doc not found');

  const body = await request.json();

  // If section data provided, upsert the section
  if (body.sectionId) {
    const sectionKey = docKey + '/sections/' + body.sectionId;
    const value = JSON.stringify({
      heading: body.heading || body.sectionId,
      content: body.content || '',
      author: body.author || 'unknown',
      signedOff: body.signedOff || false,
    });
    queries.upsertMemoryByKey(sectionKey, value, 'doc-section', null, body.author || null);

    // Update doc's author list
    let meta: any = {};
    try { meta = JSON.parse(docRow.value || '{}'); } catch {}
    if (body.author && !meta.authors?.includes(body.author)) {
      meta.authors = [...(meta.authors || []), body.author];
      queries.upsertMemoryByKey(docKey, JSON.stringify(meta), 'doc', null, null);
    }

    refreshObsidianMirror(params.docId!);
    return json({ key: sectionKey, sectionId: body.sectionId, status: 'updated' });
  }

  // Otherwise update doc metadata (status, title, etc.)
  let meta: any = {};
  try { meta = JSON.parse(docRow.value || '{}'); } catch {}
  if (body.status) meta.status = body.status;
  if (body.title) meta.title = body.title;
  if (body.description !== undefined) meta.description = body.description;
  queries.upsertMemoryByKey(docKey, JSON.stringify(meta), 'doc', null, null);

  refreshObsidianMirror(params.docId!);
  return json({ id: params.docId!, status: meta.status });
}

/** Sign off — mark doc as ready for review */
export async function POST({ params, request }: RequestEvent) {
  const docKey = DOC_PREFIX + params.docId!;
  const docRow = queries.getMemoryByKey(docKey) as any;
  if (!docRow) throw error(404, 'Doc not found');

  const body = await request.json();
  const { author, action } = body;

  let meta: any = {};
  try { meta = JSON.parse(docRow.value || '{}'); } catch {}

  if (action === 'sign-off') {
    if (!meta.signOffs) meta.signOffs = [];
    if (author && !meta.signOffs.includes(author)) {
      meta.signOffs.push(author);
    }
    // Auto-promote to ready if all authors signed off
    if (meta.authors?.length && meta.signOffs.length >= meta.authors.length) {
      meta.status = 'ready';
    }
  } else if (action === 'publish') {
    meta.status = 'published';
  }

  queries.upsertMemoryByKey(docKey, JSON.stringify(meta), 'doc', null, null);
  refreshObsidianMirror(params.docId!);
  return json({ id: params.docId!, status: meta.status, signOffs: meta.signOffs });
}
