/**
 * MCP thin-index summary — quick token-efficient overview of all CLI verbs.
 *
 * GET /api/mcp/cli-verbs/_summary
 *   → Flat list of verb IDs with primary/secondary verbs and summaries.
 *     Designed for agents that need a quick scan without loading full detail.
 *
 * Source of truth: src/lib/cli-manifest/manifest.ts
 *
 * Phase 1 / Lane C / evolveantdeep
 */
import { json } from '@sveltejs/kit';
import { manifestData } from '$lib/cli-manifest/manifest';

export const GET = async () => {
  const verbs = manifestData.map((v) => ({
    id: v.id,
    usage: v.usage,
    summary: v.summary,
    status: v.status
  }));

  const available = verbs.filter((v) => v.status === 'available').length;
  const needsWrapper = verbs.filter((v) => v.status === 'needs-wrapper').length;
  const planned = verbs.filter((v) => v.status === 'planned').length;

  return json({
    total: manifestData.length,
    available,
    needsWrapper,
    planned,
    verbs
  });
};
