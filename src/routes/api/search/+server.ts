/**
 * GET /api/search?q=...&scope=messages,plans,tasks,docs,artefacts[&limit=N]
 *
 * Scoped search across the canonical manual surfaces per DELIVERY-PLAN.md
 * M2.2 (Phase 2). Default scope = "messages" when `?scope=` absent
 * (backwards compat for the pre-M2.2 callers + CLI default).
 *
 * Each result row carries a `kind` discriminator so the CLI can render a
 * mixed-scope response without ambiguity.
 *
 * - 'messages' uses messages_fts (M2.2a)
 * - 'plans' / 'tasks' / 'docs' use LIKE on small tables (M2.2a)
 * - 'artefacts' fans out across decks + sheets + tunnels + grants stores
 *   and tags each row with a sub-kind so the CLI can distinguish (M2.2b)
 */
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

const VALID_SCOPES = new Set(['messages', 'plans', 'tasks', 'docs', 'artefacts']);

type SearchResult = { kind: string; [field: string]: unknown };

function parseScope(raw: string | null): string[] {
  if (!raw) return ['messages'];
  const parsed = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (parsed.length === 0) return ['messages'];
  return parsed;
}

function dispatchScope(scope: string, query: string, perScopeLimit: number): SearchResult[] {
  if (scope === 'messages') {
    const rows = queries.searchMessages(query, perScopeLimit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ kind: 'messages', ...r }));
  }
  if (scope === 'plans') {
    const rows = queries.searchPlanEvents(query, perScopeLimit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ kind: 'plans', ...r }));
  }
  if (scope === 'tasks') {
    const rows = queries.searchTasks(query, perScopeLimit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ kind: 'tasks', ...r }));
  }
  if (scope === 'docs') {
    const rows = queries.searchDocs(query, perScopeLimit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ kind: 'docs', ...r }));
  }
  if (scope === 'artefacts') {
    // Fan out across the 4 artefact sub-stores. Per-substore limit divides
    // the artefact scope budget so a noisy deck table doesn't crowd out
    // the others. Sub-kind discriminator on each row.
    const perSub = Math.max(1, Math.floor(perScopeLimit / 4));
    const out: SearchResult[] = [];
    const decks = queries.searchDecksByTitle(query, perSub) as Array<Record<string, unknown>>;
    for (const r of decks) out.push({ kind: 'artefacts', sub_kind: 'deck', ...r });
    const sheets = queries.searchSheetsByTitle(query, perSub) as Array<Record<string, unknown>>;
    for (const r of sheets) out.push({ kind: 'artefacts', sub_kind: 'sheet', ...r });
    const tunnels = queries.searchTunnelsByTitle(query, perSub) as Array<Record<string, unknown>>;
    for (const r of tunnels) out.push({ kind: 'artefacts', sub_kind: 'tunnel', ...r });
    const grants = queries.searchGrantsByTopic(query, perSub) as Array<Record<string, unknown>>;
    for (const r of grants) out.push({ kind: 'artefacts', sub_kind: 'grant', ...r });
    return out;
  }
  return [];
}

export function GET({ url }: RequestEvent) {
  const q = url.searchParams.get('q');
  if (!q) return json({ results: [] });

  const limit = parseInt(url.searchParams.get('limit') || '50');
  const scopes = parseScope(url.searchParams.get('scope'));
  const unknownScopes = scopes.filter((s) => !VALID_SCOPES.has(s));
  if (unknownScopes.length > 0) {
    return json(
      { results: [], error: `Unknown scope(s): ${unknownScopes.join(', ')}. Valid: messages, plans, tasks, docs, artefacts.` },
      { status: 400 }
    );
  }

  // Per-scope limit divides the budget so a mixed scope query stays
  // bounded; minimum 5 per scope to avoid pathologically tiny pages.
  const perScopeLimit = Math.max(5, Math.floor(limit / scopes.length));

  try {
    const aggregated: SearchResult[] = [];
    for (const scope of scopes) {
      aggregated.push(...dispatchScope(scope, q, perScopeLimit));
    }
    return json({ results: aggregated, scope: scopes });
  } catch {
    return json({ results: [], error: 'Invalid search query' }, { status: 400 });
  }
}
