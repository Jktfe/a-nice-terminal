/**
 * /api/tags — V2-server Phase A9 Slice 7b: tag governance CRUD.
 *
 * GET /api/tags
 *   Query: ?provenance=system|org|user&scope_id=<id>&category=<cat>
 *          &include_history=1 (full version history, default = latest-only)
 *   -> 200 { tags: TagDefinition[] }
 *
 * POST /api/tags
 *   Body: {
 *     id, name, description, category, provenance, scope_id?,
 *     protocol_resolver,
 *     is_relational?, family_root?, is_human_editable?,
 *     author_handle, author_kind, reason?
 *   }
 *   -> 201 { tag: TagDefinition }
 *   -> 400 invalid input / duplicate id
 *
 * Auth: admin-bearer (substrate boundary; F1/F2 introduces org-admin role).
 * Per the plan A9 acceptance: "org-admin + premium-tier enforced server-side,
 * client hiding is convenience only".
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  createTag,
  listTaxonomy
} from '$lib/server/verificationTaxonomyStore';
import type {
  ProtocolResolver,
  TagActorKind,
  TagLifecycleState,
  TagProvenance
} from '$lib/server/verificationTaxonomyStore';

const VALID_PROVENANCE = new Set<TagProvenance>(['system', 'org', 'user']);
const VALID_ACTOR = new Set<TagActorKind>(['human', 'agent', 'system']);

function requireAdminBearer(request: Request): void {
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    throw error(401, 'Authorization: Bearer <admin-token> required');
  }
  const adminToken = process.env.ANT_ADMIN_BEARER;
  if (!adminToken || auth.slice(7) !== adminToken) {
    throw error(403, 'Admin bearer required');
  }
}

export const GET: RequestHandler = async ({ url }) => {
  const provenance = url.searchParams.get('provenance') as TagProvenance | null;
  const scopeId = url.searchParams.get('scope_id');
  const category = url.searchParams.get('category');
  const includeHistory = url.searchParams.get('include_history') === '1';
  const lifecycleParam = url.searchParams.get('lifecycle');
  const lifecycleStates = lifecycleParam
    ? (lifecycleParam.split(',').filter((s) => s.length > 0) as TagLifecycleState[])
    : undefined;
  const tags = listTaxonomy({
    provenance: provenance ?? undefined,
    scopeId: scopeId ?? undefined,
    category: category ?? undefined,
    lifecycleStates,
    latestVersionOnly: !includeHistory
  });
  return json({ tags });
};

export const POST: RequestHandler = async ({ request }) => {
  requireAdminBearer(request);

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { throw error(400, 'JSON body required'); }

  const id = body.id;
  const name = body.name;
  const description = body.description;
  const category = body.category;
  const provenance = body.provenance as TagProvenance;
  const protocolResolver = body.protocol_resolver as ProtocolResolver;
  const authorHandle = body.author_handle;
  const authorKind = body.author_kind as TagActorKind;

  if (typeof id !== 'string' || !id) throw error(400, 'id (string) required');
  if (typeof name !== 'string' || !name) throw error(400, 'name (string) required');
  if (typeof description !== 'string') throw error(400, 'description (string) required');
  if (typeof category !== 'string' || !category) throw error(400, 'category (string) required');
  if (!VALID_PROVENANCE.has(provenance)) {
    throw error(400, `provenance must be one of: ${[...VALID_PROVENANCE].join(', ')}`);
  }
  if (!protocolResolver || typeof protocolResolver !== 'object') {
    throw error(400, 'protocol_resolver (object) required');
  }
  if (typeof authorHandle !== 'string' || !authorHandle) {
    throw error(400, 'author_handle (string) required');
  }
  if (!VALID_ACTOR.has(authorKind)) {
    throw error(400, `author_kind must be one of: ${[...VALID_ACTOR].join(', ')}`);
  }

  try {
    const tag = createTag({
      id,
      name,
      description,
      category,
      provenance,
      scopeId: typeof body.scope_id === 'string' ? body.scope_id : 'global',
      protocolResolver,
      isRelational: body.is_relational === true,
      familyRoot: typeof body.family_root === 'string' ? body.family_root : null,
      isHumanEditable: body.is_human_editable !== false,
      createdBy: authorHandle,
      actorKind: authorKind,
      createReason: typeof body.reason === 'string' ? body.reason : undefined
    });
    return json({ tag }, { status: 201 });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    throw error(400, `createTag failed: ${msg}`);
  }
};
