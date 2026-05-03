// §6.5 Provenance Resolution — exact → fallback → degraded ladder
// Never silently drop provenance. Degraded footnotes are visible.

import type { ProvenanceRef } from './types.js';

export interface ResolvedProvenance {
  kind: 'exact' | 'fallback' | 'degraded';
  label: string;
  href?: string;
  warning?: string;
}

export interface ResolveContext {
  sessionId: string;
  // Query helper injected from db.ts to avoid direct DB coupling
  getRunEventById: (id: number) =>
    | { id: number; ts_ms: number; source: string; kind: string; text: string }
    | undefined;
  queryRunEvents: (opts: {
    sessionId: string;
    source?: string;
    kind?: string;
    textLike?: string;
    limit?: number;
  }) => Array<{ id: number; ts_ms: number; source: string; kind: string; text: string }>;
}

function buildHref(id: number): string {
  return `#run-event-${id}`;
}

export function resolveProvenance(
  ref: ProvenanceRef,
  ctx: ResolveContext,
): ResolvedProvenance {
  // 1. Exact path
  if (ref.run_event_id) {
    const id = Number(ref.run_event_id);
    if (!Number.isNaN(id)) {
      const exact = ctx.getRunEventById(id);
      if (exact) {
        return {
          kind: 'exact',
          label: exact.text || `run_event ${exact.id}`,
          href: buildHref(exact.id),
        };
      }
    }
  }

  // 2. Fallback path
  if (ref.fallback) {
    const fb = ref.fallback;
    const results = ctx.queryRunEvents({
      sessionId: ctx.sessionId,
      source: fb.source,
      kind: undefined,
      textLike: fb.query || undefined,
      limit: 1,
    });
    if (results.length > 0) {
      const best = results[0];
      return {
        kind: 'fallback',
        label: `${best.text || 'matched event'} (soft-match: ${fb.source || 'any'}${fb.author ? `, ${fb.author}` : ''})`,
        href: buildHref(best.id),
        warning: 'Provenance resolved via fallback query; verify manually',
      };
    }
  }

  // 3. Degraded — never silently dropped
  const parts: string[] = [];
  if (ref.run_event_id) parts.push(`run_event_id=${ref.run_event_id}`);
  if (ref.fallback) {
    const fb = ref.fallback;
    if (fb.source) parts.push(`source=${fb.source}`);
    if (fb.author) parts.push(`author=${fb.author}`);
    if (fb.section) parts.push(`section=${fb.section}`);
    if (fb.query) parts.push(`query=${fb.query}`);
  }

  return {
    kind: 'degraded',
    label: parts.length > 0 ? parts.join('; ') : 'unresolved provenance',
    warning: '⚠ Provenance could not be resolved; evidence may be missing',
  };
}

export function resolveAllProvenance(
  refs: ProvenanceRef[] | undefined,
  ctx: ResolveContext,
): ResolvedProvenance[] {
  if (!refs || refs.length === 0) return [];
  return refs.map((ref) => resolveProvenance(ref, ctx));
}
