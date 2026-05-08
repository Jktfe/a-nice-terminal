// M3.5 PlanView — component-local PlanEvent types.
//
// Mirrors R4 §6.5 schema verbatim. Five kinds:
//   plan_section    — sticky framed section (rarely mutates)
//   plan_decision   — compact decision row with provenance footnotes
//   plan_milestone  — work-package card with status, owner, expandable body
//   plan_acceptance — stable narrative criterion (one per milestone, rarely mutates)
//   plan_test       — mutable checkable row proving the criterion
//
// The split between plan_acceptance (stable) and plan_test (mutable) is
// load-bearing: @gemma4local can update test pass/fail without rewriting
// the criterion. See §6.5 "Decision: use separate plan_acceptance and
// plan_test kinds".
//
// The canonical type belongs to @ocloudant-dev's projector lane; when it
// lands, import-swap this file's PlanEvent for the canonical export.

export type PlanEventKind =
  | 'plan_section'
  | 'plan_decision'
  | 'plan_milestone'
  | 'plan_acceptance'
  | 'plan_test';

export type PlanStatus =
  | 'planned'
  | 'active'
  | 'blocked'
  | 'passing'
  | 'failing'
  | 'done'
  | 'archived';

export interface EvidenceRef {
  kind: 'run_event' | 'raw_ref' | 'task' | 'source_url' | 'file';
  ref: string;
  label?: string;
}

export interface ProvenanceRef {
  run_event_id?: string;
  fallback?: {
    source?: string;
    author?: string;
    section?: string;
    query?: string;
  };
}

export interface PlanEventPayload {
  plan_id: string;
  parent_id?: string;
  title: string;
  body?: string;
  order: number;
  status?: PlanStatus;
  owner?: string;
  milestone_id?: string;
  acceptance_id?: string;
  evidence?: EvidenceRef[];
  provenance?: ProvenanceRef[];
}

// Local RunEvent base — to be import-swapped for canonical when @ocloudant-dev
// lands the projector. Source enum extends per R4 §5.
export type PlanEventSource =
  | 'hook'
  | 'json'
  | 'rpc'
  | 'mcp'
  | 'acp'
  | 'terminal'
  | 'status'
  | 'tmux';

export type PlanEventTrust = 'high' | 'medium' | 'raw';

export interface PlanEvent {
  id: string;
  session_id: string;
  ts: number;
  ts_ms?: number;
  source: PlanEventSource;
  trust: PlanEventTrust;
  kind: PlanEventKind;
  text?: string;
  payload: PlanEventPayload;
  raw_ref?: string;
  created_at?: string | null;
}

export interface PlanTaskRef {
  id: string;
  title: string;
  status: string;
  created_by?: string | null;
  assigned_to?: string | null;
  created_source?: string | null;
  plan_id?: string | null;
  milestone_id?: string | null;
  acceptance_id?: string | null;
}

// Resolution result for a provenance reference. §6.5: "Do not silently drop
// provenance" — degraded fallback must render with warning state.
export interface ProvenanceResolution {
  state: 'exact' | 'fallback' | 'unresolved';
  href?: string;
  label: string;
  hint?: string;
}

export function resolveProvenance(p: ProvenanceRef): ProvenanceResolution {
  if (p.run_event_id) {
    return {
      state: 'exact',
      href: `/api/run_events/${p.run_event_id}`,
      label: p.run_event_id,
    };
  }
  if (p.fallback) {
    const parts: string[] = [];
    if (p.fallback.author) parts.push(p.fallback.author);
    if (p.fallback.source) parts.push(p.fallback.source);
    if (p.fallback.section) parts.push(p.fallback.section);
    return {
      state: 'fallback',
      label: parts.join(' · ') || (p.fallback.query ?? 'fallback'),
      hint: p.fallback.query,
    };
  }
  return { state: 'unresolved', label: 'unresolved provenance' };
}
