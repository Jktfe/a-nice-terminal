/**
 * /api/tools — PR-D tools catalog endpoint (plan milestone
 * pr-d-tools-catalog of ant-substrate-v0.2-2026-05-29).
 *
 * POST  /api/tools         (admin-bearer) → register a tool row.
 * GET   /api/tools         (open read)    → list active tools, filter
 *                                            by kind / owner_org /
 *                                            includeRetired=1.
 *
 * Closes JWPK's "nifty-leak" case (msg_mjh7rgi3wa + msg_6gq9zczigb):
 * the substrate now has a single queryable catalog instead of N
 * filesystem-loaded globs + per-client MCP configs + hardcoded CLI
 * dispatch tables.
 *
 * Auth model (Stage A scope): admin-bearer only on the write side.
 * Org-admin attestation lands with the substrate-wide trust_pubkey
 * lift queued in the plan; the row shape is forward-compatible.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAggregateReadAuth } from '$lib/server/aggregateReadAuth';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import {
  registerTool,
  listTools,
  type ListToolsFilters,
  type ToolKind,
  type ToolMinTier
} from '$lib/server/toolsCatalogStore';

const VALID_KINDS: ReadonlyArray<ToolKind> = [
  'skill',
  'mcp',
  'cli-verb',
  'hook',
  'plugin',
  'bridge'
];

const VALID_MIN_TIERS: ReadonlyArray<ToolMinTier> = ['oss', 'premium', 'internal'];

export const POST: RequestHandler = async ({ request }) => {
  requireAdminAuth(request);
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!body || typeof body !== 'object') {
    throw error(400, 'JSON body required.');
  }
  const toolSlug = body.toolSlug;
  if (typeof toolSlug !== 'string' || toolSlug.trim().length === 0) {
    throw error(400, 'toolSlug (non-empty string) required');
  }
  const kind = body.kind;
  if (typeof kind !== 'string' || !VALID_KINDS.includes(kind as ToolKind)) {
    throw error(400, `kind must be one of: ${VALID_KINDS.join(', ')}`);
  }
  const name = body.name;
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw error(400, 'name (non-empty string) required');
  }
  let minTier: ToolMinTier | undefined;
  if (body.minTier !== undefined) {
    if (
      typeof body.minTier !== 'string' ||
      !VALID_MIN_TIERS.includes(body.minTier as ToolMinTier)
    ) {
      throw error(400, `minTier must be one of: ${VALID_MIN_TIERS.join(', ')}`);
    }
    minTier = body.minTier as ToolMinTier;
  }
  let metadata: Record<string, unknown> | undefined;
  if (body.metadata !== undefined) {
    if (
      typeof body.metadata !== 'object' ||
      body.metadata === null ||
      Array.isArray(body.metadata)
    ) {
      throw error(400, 'metadata must be a JSON object');
    }
    metadata = body.metadata as Record<string, unknown>;
  }
  const tool = registerTool({
    toolSlug: toolSlug.trim(),
    kind: kind as ToolKind,
    name: name.trim(),
    description: typeof body.description === 'string' ? body.description : undefined,
    version: typeof body.version === 'string' ? body.version : undefined,
    sourcePath: typeof body.sourcePath === 'string' ? body.sourcePath : undefined,
    ownerOrg: typeof body.ownerOrg === 'string' ? body.ownerOrg : undefined,
    minTier,
    metadata
  });
  return json({ tool }, { status: 201 });
};

export const GET: RequestHandler = async ({ request, url }) => {
  requireAggregateReadAuth(request, '/api/tools');
  const filters: ListToolsFilters = {};
  const kindParam = url.searchParams.get('kind');
  if (kindParam) {
    if (!VALID_KINDS.includes(kindParam as ToolKind)) {
      throw error(400, `kind must be one of: ${VALID_KINDS.join(', ')}`);
    }
    filters.kind = kindParam as ToolKind;
  }
  const ownerOrg = url.searchParams.get('owner_org');
  if (ownerOrg) filters.ownerOrg = ownerOrg;
  const includeRetired = url.searchParams.get('includeRetired');
  if (includeRetired === '1' || includeRetired === 'true') {
    filters.includeRetired = true;
  }
  return json({ tools: listTools(filters) });
};
