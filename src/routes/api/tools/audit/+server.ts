/**
 * /api/tools/audit — PR-D tools catalog audit endpoint (plan milestone
 * pr-d-tools-catalog of ant-substrate-v0.2-2026-05-29).
 *
 * Single GET that takes ?audit=tools|grants|revocations|orphans and
 * fans out to the store helpers. Keeps the CLI renderer pure.
 *
 *   ?audit=tools [&owner_org=…] [&includeRetired=1]
 *     → { tools: Array<Tool & { grantCount }> }
 *
 *   ?audit=grants [&agent=…] [&tool=slug] [&scope_kind=…]
 *     → { grants: Array<Grant & { toolSlug }> } (active only)
 *
 *   ?audit=revocations &since_ms=… [&owner_org=…]
 *     → { revocations: Array<Grant & { toolSlug }> }
 *
 *   ?audit=orphans
 *     → { orphanGrants: Array<Grant & { toolSlug }>,
 *         orphanTools:  Array<Tool> }
 *
 * Read access is open in Stage A — audit data is non-sensitive (slugs
 * + handles + grant ids). Stage B may add tenant-scoping when the
 * tenant_id row-scoping milestone lands.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  listTools,
  listGrantsForAgent,
  listGrantsForTool,
  listOrphanGrants,
  listOrphanedTools,
  listRevocationsSince,
  countActiveGrantsForTool,
  findToolById,
  findToolBySlug,
  type ToolKind,
  type ToolGrantScopeKind,
  type ToolRecord,
  type ToolGrantRecord
} from '$lib/server/toolsCatalogStore';

const VALID_SCOPE_KINDS: ReadonlyArray<ToolGrantScopeKind> = [
  'global',
  'org',
  'room',
  'session'
];
const VALID_KINDS: ReadonlyArray<ToolKind> = [
  'skill',
  'mcp',
  'cli-verb',
  'hook',
  'plugin',
  'bridge'
];

function attachToolSlug(grant: ToolGrantRecord): ToolGrantRecord & { toolSlug: string | null } {
  const tool = findToolById(grant.toolId);
  return { ...grant, toolSlug: tool?.toolSlug ?? null };
}

function attachGrantCount(tool: ToolRecord): ToolRecord & { grantCount: number } {
  return { ...tool, grantCount: countActiveGrantsForTool(tool.toolId) };
}

export const GET: RequestHandler = async ({ url }) => {
  const audit = url.searchParams.get('audit') ?? 'tools';
  if (audit === 'tools') {
    const ownerOrg = url.searchParams.get('owner_org') ?? undefined;
    const includeRetired =
      url.searchParams.get('includeRetired') === '1' ||
      url.searchParams.get('includeRetired') === 'true';
    const tools = listTools({ ownerOrg, includeRetired }).map(attachGrantCount);
    return json({ tools });
  }
  if (audit === 'grants') {
    const agent = url.searchParams.get('agent');
    const toolSlug = url.searchParams.get('tool');
    const scopeKind = url.searchParams.get('scope_kind');
    if (scopeKind && !VALID_SCOPE_KINDS.includes(scopeKind as ToolGrantScopeKind)) {
      throw error(400, `scope_kind must be one of: ${VALID_SCOPE_KINDS.join(', ')}`);
    }
    let grants: ToolGrantRecord[] = [];
    if (agent) {
      grants = listGrantsForAgent(agent);
    } else if (toolSlug) {
      const tool = findToolBySlug(toolSlug, { includeRetired: true });
      if (!tool) return json({ grants: [] });
      grants = listGrantsForTool(tool.toolId);
    } else {
      // No agent + no tool filter — derive from listTools so we don't
      // expose a "give me every grant ever" surface in one call. Use
      // listGrantsForTool per active tool as an audit fan-out.
      const tools = listTools({ includeRetired: true });
      for (const t of tools) {
        grants.push(...listGrantsForTool(t.toolId));
      }
    }
    let filtered = grants.filter((g) => g.revokedAtMs === null);
    if (scopeKind) {
      filtered = filtered.filter((g) => g.scopeKind === scopeKind);
    }
    return json({ grants: filtered.map(attachToolSlug) });
  }
  if (audit === 'revocations') {
    const sinceMsRaw = url.searchParams.get('since_ms');
    const sinceMs = sinceMsRaw ? Number(sinceMsRaw) : 7 * 86_400_000;
    if (!Number.isFinite(sinceMs) || sinceMs <= 0) {
      throw error(400, 'since_ms must be a positive number');
    }
    const cutoff = Date.now() - sinceMs;
    const ownerOrg = url.searchParams.get('owner_org') ?? undefined;
    const revocations = listRevocationsSince(cutoff).map(attachToolSlug);
    const filtered = ownerOrg
      ? revocations.filter((r) => {
          const tool = findToolById(r.toolId);
          return tool?.ownerOrg === ownerOrg;
        })
      : revocations;
    return json({ revocations: filtered });
  }
  if (audit === 'orphans') {
    const orphanGrants = listOrphanGrants().map(attachToolSlug);
    const orphanTools = listOrphanedTools();
    return json({ orphanGrants, orphanTools });
  }
  // Default kind filter on tools surface (used implicitly by callers).
  const kindParam = url.searchParams.get('kind');
  if (kindParam) {
    if (!VALID_KINDS.includes(kindParam as ToolKind)) {
      throw error(400, `kind must be one of: ${VALID_KINDS.join(', ')}`);
    }
  }
  throw error(400, `audit must be one of: tools, grants, revocations, orphans`);
};
