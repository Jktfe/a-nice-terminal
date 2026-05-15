/**
 * Programme board snapshot — the live data behind /ant in v3.
 *
 * Copied-from: /Users/jamesking/CascadeProjects/ant/src/lib/server/programmeBoardData.ts
 * Verdict: vendored to a-nice-terminal so the v3 SvelteKit server (com.ant.server)
 *   can render the same programme board at /ant. PROGRAMME.md remains canonical.
 * Simplification: identical content + types; no edits beyond this header.
 *
 * Parity rule: when the fresh-ant snapshot updates, this file gets a small
 * follow-up edit slice to stay in sync.
 */

export const STRICT_STATUS_LABELS = [
  'Accepted Baseline',
  'Review-Ready',
  'Review-Held',
  'Claim-Ready',
  'Deferred',
  'Out-of-Scope'
] as const;

export type StrictStatusLabel = (typeof STRICT_STATUS_LABELS)[number];

export type AcceptedBaselineRow = {
  lane: string;
  slice: string;
  owner: string;
};

export type InFlightSliceRow = {
  lane: string;
  slice: string;
  status: 'Review-Ready' | 'Review-Held' | 'Claim-Ready';
  owner: string;
};

export type DeferredRow = {
  lane: string;
  reason: string;
  futureTag: string;
};

export type OutOfScopeRow = {
  lane: string;
  directive: string;
  dateIso: string;
};

export type LaneMatrixCell = 'Accepted' | 'Review-Held' | 'Not started' | 'Out of scope' | '—';

export type LaneMatrixRow = {
  lane: string;
  cells: LaneMatrixCell[];
  notes: string;
};

export type OwnerReferenceRow = {
  agent: string;
  role: string;
};

export type ProgrammeBoardSnapshot = {
  lockedScopeSentence: string;
  lastUpdatedIso: string;
  acceptedBaselines: AcceptedBaselineRow[];
  inFlightSlices: InFlightSliceRow[];
  deferred: DeferredRow[];
  outOfScope: OutOfScopeRow[];
  laneMatrix: LaneMatrixRow[];
  owners: OwnerReferenceRow[];
};

export const LOCKED_SCOPE_SENTENCE =
  'ANT vNext captures, routes, and renders multi-agent room work. ' +
  'Model routing belongs to mymatedave, not ANT. Display-only agent ' +
  'model/cost metadata stays as evidence, not policy.';

export const LAST_UPDATED_ISO = '2026-05-12';

export const PROGRAMME_BOARD_SNAPSHOT: ProgrammeBoardSnapshot = {
  lockedScopeSentence: LOCKED_SCOPE_SENTENCE,
  lastUpdatedIso: LAST_UPDATED_ISO,
  acceptedBaselines: [
    { lane: 'M01 chatrooms', slice: 'start a chatroom', owner: '@evolveantclaude' },
    { lane: 'M02 invites', slice: 'invite an agent', owner: '@evolveantclaude' },
    { lane: 'M03 participants panel', slice: 'slices 1–5 + 4.1 (full WTHef board)', owner: '@claude2' },
    { lane: 'M11 attachments', slice: 'backend + UI list/download + UI upload', owner: '@evolveantclaude' },
    { lane: 'M12 break-context', slice: 'break primitive + endpoint + UI', owner: '@evolveantclaude' },
    { lane: 'M13 rename-chatroom', slice: 'endpoint + header form', owner: '@evolveantclaude' },
    { lane: 'M14 search messages', slice: 'backend + /search UI', owner: '@evolveantclaude' },
    { lane: 'M16 agent-timeline', slice: 'slice 1 + slice 2 room slot', owner: '@evolveantclaude' },
    { lane: 'M17 reactions', slice: 'backend + UI chips on MessageRow', owner: '@claude2' },
    { lane: 'M19 typing-indicator', slice: 'backend + UI strip', owner: '@claude2' },
    { lane: 'M22 in-room asks', slice: 'panel + answer/dismiss', owner: '@evolveantclaude' },
    { lane: 'M24 read-receipts', slice: 'backend + UI indicator', owner: '@evolveantclaude' },
    { lane: 'M29 chair digest', slice: '1–4b + asks-summary', owner: '@evolveantclaude' },
    { lane: 'M30 threading', slice: 'store + endpoint + slices 3a–3e', owner: 'split' },
    { lane: 'M31 CLI rooms', slice: 'ant CLI verbs', owner: '@evolveantclaude' },
    { lane: 'Memory recall', slice: 'slices 1–10', owner: '@evolveantclaude' },
    { lane: 'Asks foundation', slice: 'slice 1 + slice 2 + /asks UI', owner: '@evolveantclaude' },
    { lane: 'Draft persistence', slice: 'backend slice 1', owner: '@claude2' },
    { lane: 'Chair-rename mechanical', slice: 'slice 2a (Chairman → Chair)', owner: '@evolveantclaude' },
    { lane: 'R4 room error boundary', slice: '+error.svelte', owner: '@evolveantclaude' },
    { lane: 'PROGRAMME.md', slice: 'canonical programme doc', owner: '@evolveantclaude' },
    { lane: 'Router-revert', slice: 'slice 1 (M28 removed by JWPK directive)', owner: '@evolveantclaude' },
    { lane: 'ModelRoutingPolicy → AgentModel rename', slice: 'cosmetic display-data rename per scope clarification', owner: '@evolveantclaude' }
  ],
  inFlightSlices: [
    {
      lane: 'Focus mode',
      slice: 'backend slice 1 (store + endpoint)',
      status: 'Review-Held',
      owner: '@claude2'
    },
    {
      lane: '/plan live route',
      slice: 'slice 1 (snapshot + render)',
      status: 'Review-Ready',
      owner: '@claude2'
    },
    {
      lane: 'R5 rooms list empty-state',
      slice: 'revised contract',
      status: 'Claim-Ready',
      owner: '@claude2'
    },
    {
      lane: 'Chair settings toggle',
      slice: 'slice 2b (Chair-stays-on)',
      status: 'Claim-Ready',
      owner: '@evolveantclaude'
    }
  ],
  deferred: [
    {
      lane: 'M20 B1 — asHandle session identity',
      reason: 'platform-completeness primitive (auth/identity wiring needed first)',
      futureTag: 'session-identity-slice'
    },
    {
      lane: 'R7 InviteAgentForm state split',
      reason: 'InviteAgentForm at 255/260 — needs split-first plan before refactor',
      futureTag: 'invite-form-split-1'
    },
    {
      lane: 'Composer draft UI wiring',
      reason: 'ChatComposer frozen at 229/230; needs split-before-touch',
      futureTag: 'draft-ui-slice-1'
    },
    {
      lane: 'Focus mode UI wiring',
      reason: 'depends on Focus mode backend baseline + composer split',
      futureTag: 'focus-ui-slice-1'
    }
  ],
  outOfScope: [
    {
      lane: 'Model routing (M28)',
      directive: 'JWPK: model routing is mymatedave land, not ANT',
      dateIso: '2026-05-12'
    }
  ],
  laneMatrix: [
    { lane: 'M03 participants', cells: ['Accepted', 'Accepted', 'Accepted', 'Accepted', 'Accepted', 'Accepted'], notes: 'WTHef board closed end-to-end' },
    { lane: 'M11 attachments', cells: ['Accepted', 'Accepted', 'Accepted', 'Not started', 'Not started', '—'], notes: 'upload + list + download shipped' },
    { lane: 'M16 agent-timeline', cells: ['Accepted', 'Accepted', 'Not started', 'Not started', 'Not started', '—'], notes: 'room-page slot accepted' },
    { lane: 'M17 reactions', cells: ['Accepted', 'Accepted', 'Not started', 'Not started', 'Not started', '—'], notes: 'chips on MessageRow' },
    { lane: 'M19 typing', cells: ['Accepted', 'Accepted', 'Not started', 'Not started', 'Not started', '—'], notes: 'backend + UI strip' },
    { lane: 'M22 asks panel', cells: ['Accepted', 'Accepted', 'Not started', 'Not started', 'Not started', '—'], notes: 'in-room answer/dismiss baseline' },
    { lane: 'M24 read receipts', cells: ['Accepted', 'Accepted', 'Not started', 'Not started', 'Not started', '—'], notes: 'row indicator baseline' },
    { lane: 'M28 routing', cells: ['Out of scope', 'Out of scope', 'Out of scope', '—', '—', '—'], notes: 'removed by JWPK directive' },
    { lane: 'M29 chair', cells: ['Accepted', 'Accepted', 'Accepted', 'Accepted', 'Not started', '—'], notes: 'digest + notes + UI + LLM seam + push' },
    { lane: 'M30 threading', cells: ['Accepted', 'Accepted', 'Accepted', 'Accepted', 'Accepted', '—'], notes: 'store + endpoint + slices 3a–3e' },
    { lane: 'M31 CLI', cells: ['Accepted', 'Not started', 'Not started', 'Not started', 'Not started', '—'], notes: 'rooms surface live' },
    { lane: 'Memory recall', cells: ['Accepted', 'Accepted', 'Accepted', 'Accepted', 'Accepted', '—'], notes: 'slices 1–10' },
    { lane: 'Asks', cells: ['Accepted', 'Accepted', 'Accepted', 'Not started', 'Not started', '—'], notes: 'open/list + answer/dismiss + UI' },
    { lane: 'Draft persistence', cells: ['Accepted', 'Not started', 'Not started', 'Not started', 'Not started', '—'], notes: 'backend only; UI awaits composer split' },
    { lane: 'Focus mode', cells: ['Review-Held', 'Not started', 'Not started', 'Not started', 'Not started', '—'], notes: 'shipped pre-QA gate, review-held' },
    { lane: 'Chair-rename', cells: ['—', 'Accepted', 'Not started', 'Not started', 'Not started', '—'], notes: 'slice 2a mechanical; 2b toggle queued' }
  ],
  owners: [
    { agent: '@claude2', role: 'implementer (chat/room lane, drafts, focus, R5)' },
    { agent: '@evolveantclaude', role: 'delivery boss + implementer (room route, chair, threading, M11/14/16/29)' },
    { agent: '@evolveantcodex', role: 'QA gate / baseline promotion' },
    { agent: '@codex2', role: 'code reviewer (PASS / BLOCKER)' },
    { agent: '@kimi', role: 'audit lane (security / contract / regression)' },
    { agent: '@glm', role: 'audit lane (route / data-flow / a11y)' }
  ]
};
