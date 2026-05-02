// M3.5 PlanView visual harness fixture.
// Projects R4 Decision Output (docs/ANTstorm-terminal-research.md §1–§7) as
// plan_* events per §6.5 schema. Selective coverage — enough to exercise
// every component variant against the prototype HTML, not exhaustive R4 text.
// Replaces with live projector data once @ocloudant-dev lands the canonical
// projection (writeLogAndProject in src/lib/server, owner: @ocloudant-dev).

import type { PlanEvent } from './types';

const SES = 'ses_r4';
const PLAN = 'ant-r4';
const ts0 = 1746189000000;
let n = 0;
const tick = () => ts0 + ++n;

const ev = <T extends Partial<PlanEvent>>(e: T): PlanEvent =>
  ({
    id: `evt_${String(++n).padStart(3, '0')}`,
    session_id: SES,
    ts: tick(),
    source: 'json',
    trust: 'high',
    ...e,
  } as PlanEvent);

export const samplePlanEvents: PlanEvent[] = [
  // ───── Sections ─────
  ev({ id: 'sec-non-negotiables', kind: 'plan_section', payload: { plan_id: PLAN, title: 'Non-negotiables', body: '7 rules · override everything below', order: 1 } }),
  ev({ id: 'sec-architecture', kind: 'plan_section', payload: { plan_id: PLAN, title: 'Source-of-truth architecture', body: 'one log, four projections', order: 2 } }),
  ev({ id: 'sec-track1', kind: 'plan_section', payload: { plan_id: PLAN, title: 'Track 1 — ANT Terminal', body: 'rich · quiet · readable', order: 3 } }),
  ev({ id: 'sec-track2', kind: 'plan_section', payload: { plan_id: PLAN, title: 'Track 2 — RAW Browser Terminal', body: 'the contract that lets Track 1 be beautiful without becoming misleading', order: 4 } }),
  ev({ id: 'sec-milestones', kind: 'plan_section', payload: { plan_id: PLAN, title: 'Milestones', body: '5 + 1 · ordered · with measurable acceptance', order: 5 } }),
  ev({ id: 'sec-deferred', kind: 'plan_section', payload: { plan_id: PLAN, title: 'Deferred bets', body: '10 · considered, pushed out, with rationale', order: 6 } }),

  // ───── §1 Non-negotiables (decisions) ─────
  ev({
    kind: 'plan_decision',
    payload: {
      plan_id: PLAN,
      parent_id: 'sec-non-negotiables',
      title: 'The Raw Terminal is byte-faithful.',
      body: 'No structured layer can drop, reorder, or summarise PTY bytes.',
      order: 1,
    },
  }),
  ev({
    kind: 'plan_decision',
    payload: { plan_id: PLAN, parent_id: 'sec-non-negotiables', title: 'Timestamps are required signal on every event.', order: 2 },
  }),
  ev({
    kind: 'plan_decision',
    payload: { plan_id: PLAN, parent_id: 'sec-non-negotiables', title: 'trust:raw bytes never render as rich content.', order: 3 },
  }),
  ev({
    kind: 'plan_decision',
    payload: { plan_id: PLAN, parent_id: 'sec-non-negotiables', title: 'Status displays separately from the timeline.', order: 4 },
  }),
  ev({
    kind: 'plan_decision',
    payload: { plan_id: PLAN, parent_id: 'sec-non-negotiables', title: "The user's intent is the main grid.", order: 5 },
  }),
  ev({
    kind: 'plan_decision',
    payload: { plan_id: PLAN, parent_id: 'sec-non-negotiables', title: 'Trust belongs to events, not agents.', order: 6 },
  }),
  ev({
    kind: 'plan_decision',
    payload: { plan_id: PLAN, parent_id: 'sec-non-negotiables', title: 'No code is shipped from ANTstorm.', order: 7 },
  }),

  // ───── §3 Track 1 (decisions a-f) ─────
  ev({
    kind: 'plan_decision',
    payload: {
      plan_id: PLAN,
      parent_id: 'sec-track1',
      title: 'run_events is the primary interpretative projection.',
      body: 'CommandBlock renders from a run_event object, not flat props. Three kinds: command_block, agent_prompt, artifact.',
      order: 1,
      provenance: [
        { fallback: { author: '@ocloudant', source: 'R1', section: '§1' } },
        { fallback: { author: '@antclaude', source: 'R1 supporter', section: '§4' } },
      ],
    },
  }),
  ev({
    kind: 'plan_decision',
    payload: {
      plan_id: PLAN,
      parent_id: 'sec-track1',
      title: 'Rich content via /api/artifacts/, never PTY.',
      body: 'Sixel / Kitty / OSC 1337 NOT enabled in Phase 1. Raw Terminal never receives placeholder bytes.',
      order: 2,
      provenance: [{ fallback: { author: '@gemini', source: 'R3', section: '§3' } }],
    },
  }),
  ev({
    kind: 'plan_decision',
    payload: {
      plan_id: PLAN,
      parent_id: 'sec-track1',
      title: 'Inline overlay prompt cards anchored to scroll position.',
      order: 3,
      provenance: [{ fallback: { author: '@antcodex', source: 'R4 review' } }],
    },
  }),
  ev({
    kind: 'plan_decision',
    payload: {
      plan_id: PLAN,
      parent_id: 'sec-track1',
      title: 'Cool-AF visual rules — restraint over badges.',
      body: 'Hide chrome by default; one typeface, two weights, two sizes; motion that means something.',
      order: 4,
      provenance: [{ fallback: { author: 'james', source: 'terminalChat thread' } }],
    },
  }),
  ev({
    kind: 'plan_decision',
    payload: {
      plan_id: PLAN,
      parent_id: 'sec-track1',
      title: 'Sanitised renderer. trust-tier-locked.',
      body: 'high renders rich; medium renders structured but escaped; raw never rich.',
      order: 5,
    },
  }),
  ev({
    kind: 'plan_decision',
    payload: { plan_id: PLAN, parent_id: 'sec-track1', title: 'Raw Terminal is one tab/click away — escape hatch, not default.', order: 6 },
  }),

  // ───── §6 Milestones ─────
  ev({
    id: 'M1', kind: 'plan_milestone',
    payload: {
      plan_id: PLAN,
      parent_id: 'sec-milestones',
      title: 'OSC 133 shell hooks foundation',
      body: 'Track 2 baseline',
      order: 1,
      milestone_id: 'M1',
      owner: '@antcodex-dev',
      status: 'done',
      evidence: [{ kind: 'task', ref: 'localANTtasks:gc6Dti9F', label: 'localANTtasks · gc6Dti9F' }],
      provenance: [{ fallback: { source: 'R1', section: '§6', author: 'Codex' } }],
    },
  }),
  ev({
    id: 'M2', kind: 'plan_milestone',
    payload: {
      plan_id: PLAN,
      parent_id: 'sec-milestones',
      title: 'WebGL renderer behind feature flag',
      body: 'Track 2 quick win',
      order: 2,
      milestone_id: 'M2',
      owner: '@antcodex-dev',
      status: 'planned',
      provenance: [{ fallback: { source: 'R2', section: '§3', author: 'Gemini' } }],
    },
  }),
  ev({
    id: 'M3', kind: 'plan_milestone',
    payload: {
      plan_id: PLAN,
      parent_id: 'sec-milestones',
      title: 'CommandBlock visual prototype',
      body: 'Track 1 cool-AF',
      order: 3,
      milestone_id: 'M3',
      owner: '@antclaude-dev',
      status: 'done',
      evidence: [
        { kind: 'source_url', ref: 'commit:6e7dc4c', label: 'delivery/m3-commandblock-ui · 6e7dc4c' },
        { kind: 'file', ref: 'docs/m3-commandblock-evidence.png', label: 'visual evidence' },
      ],
    },
  }),
  ev({
    id: 'M3.5', kind: 'plan_milestone',
    payload: {
      plan_id: PLAN,
      parent_id: 'sec-milestones',
      title: 'Plan View — dogfood the architecture',
      body: 'Track 1 meta',
      order: 4,
      milestone_id: 'M3.5',
      owner: '@antclaude-dev',
      status: 'active',
      evidence: [{ kind: 'file', ref: 'docs/plan-view-prototype.html', label: 'visual north star' }],
      provenance: [{ fallback: { source: 'terminalChat', author: 'james', query: 'an md doesnt cut it' } }],
    },
  }),
  ev({
    id: 'M4', kind: 'plan_milestone',
    payload: {
      plan_id: PLAN,
      parent_id: 'sec-milestones',
      title: 'Pi RPC structured transport adapter',
      body: 'high-trust integration',
      order: 5,
      milestone_id: 'M4',
      owner: '@antcodex-dev',
      status: 'planned',
    },
  }),
  ev({
    id: 'M5', kind: 'plan_milestone',
    payload: {
      plan_id: PLAN,
      parent_id: 'sec-milestones',
      title: 'Hermes ACP integration',
      body: 'pattern validation',
      order: 6,
      milestone_id: 'M5',
      owner: '@antcodex-dev',
      status: 'planned',
    },
  }),

  // ───── Acceptance criteria (one per milestone) ─────
  ev({
    id: 'M1-acc', kind: 'plan_acceptance',
    payload: {
      plan_id: PLAN,
      parent_id: 'M1',
      milestone_id: 'M1',
      title: 'OSC 133 acceptance flow',
      body:
        '`ls && false && echo ok` produces exactly three run_events with kinds command_block and exit-code values 0, 1, 0. ' +
        'Same test passes through tmux-mediated reconnect: no duplicate events, no missing event, monotonic timestamps, ' +
        'non-overlapping raw byte offsets, visible terminal state matches `tmux capture-pane -e -J`.',
      order: 1,
      acceptance_id: 'M1-acc',
    },
  }),
  ev({
    id: 'M3-acc', kind: 'plan_acceptance',
    payload: {
      plan_id: PLAN,
      parent_id: 'M3',
      milestone_id: 'M3',
      title: 'CommandBlock skim test',
      body:
        'A non-technical viewer skims a 30-minute session and can describe what happened in under 30 seconds without reading any inline timestamps. Status badges live separately from the flow.',
      order: 1,
      acceptance_id: 'M3-acc',
    },
  }),
  ev({
    id: 'M3.5-acc', kind: 'plan_acceptance',
    payload: {
      plan_id: PLAN,
      parent_id: 'M3.5',
      milestone_id: 'M3.5',
      title: 'Plan View reads in 5 minutes',
      body:
        'Non-technical viewer reads R4 plan rendered in ANT in under 5 minutes and can explain what we are building. ' +
        'Renders from plan_section / plan_decision / plan_milestone / plan_acceptance / plan_test events. ' +
        'Updating plan_test.status changes only that row and the derived milestone/side-rail status; it does not rewrite plan_acceptance.',
      order: 1,
      acceptance_id: 'M3.5-acc',
    },
  }),

  // ───── M1 plan_test rows (mutable) ─────
  ev({
    kind: 'plan_test',
    payload: {
      plan_id: PLAN,
      parent_id: 'M1-acc',
      milestone_id: 'M1',
      acceptance_id: 'M1-acc',
      title: 'shell-integration files inject without modifying user rc',
      order: 1,
      status: 'passing',
    },
  }),
  ev({
    kind: 'plan_test',
    payload: {
      plan_id: PLAN,
      parent_id: 'M1-acc',
      milestone_id: 'M1',
      acceptance_id: 'M1-acc',
      title: 'OSC 133 A/B/C/D parsed in pty-daemon',
      order: 2,
      status: 'passing',
    },
  }),
  ev({
    kind: 'plan_test',
    payload: {
      plan_id: PLAN,
      parent_id: 'M1-acc',
      milestone_id: 'M1',
      acceptance_id: 'M1-acc',
      title: 'three run_events landed for ls && false && echo ok',
      order: 3,
      status: 'passing',
    },
  }),
  ev({
    kind: 'plan_test',
    payload: {
      plan_id: PLAN,
      parent_id: 'M1-acc',
      milestone_id: 'M1',
      acceptance_id: 'M1-acc',
      title: 'tmux reconnect produces no duplicate or missing events',
      order: 4,
      status: 'planned',
    },
  }),
  ev({
    kind: 'plan_test',
    payload: {
      plan_id: PLAN,
      parent_id: 'M1-acc',
      milestone_id: 'M1',
      acceptance_id: 'M1-acc',
      title: 'byte offsets non-overlapping across reconnect',
      order: 5,
      status: 'planned',
    },
  }),

  // ───── M3 plan_test rows ─────
  ev({
    kind: 'plan_test',
    payload: {
      plan_id: PLAN,
      parent_id: 'M3-acc',
      milestone_id: 'M3',
      acceptance_id: 'M3-acc',
      title: 'CommandBlock renders from {event: RunEvent} not flat props',
      order: 1,
      status: 'passing',
      evidence: [{ kind: 'source_url', ref: 'commit:6e7dc4c' }],
    },
  }),
  ev({
    kind: 'plan_test',
    payload: {
      plan_id: PLAN,
      parent_id: 'M3-acc',
      milestone_id: 'M3',
      acceptance_id: 'M3-acc',
      title: 'trust:raw renders without rich treatment',
      order: 2,
      status: 'passing',
      evidence: [{ kind: 'file', ref: 'docs/m3-commandblock-evidence.png' }],
    },
  }),
  ev({
    kind: 'plan_test',
    payload: {
      plan_id: PLAN,
      parent_id: 'M3-acc',
      milestone_id: 'M3',
      acceptance_id: 'M3-acc',
      title: '30-second skim test by non-technical viewer',
      order: 3,
      status: 'planned',
    },
  }),

  // ───── §7 Deferred bets (subset) ─────
  ev({
    kind: 'plan_decision',
    payload: {
      plan_id: PLAN,
      parent_id: 'sec-deferred',
      title: 'Inline graphics protocols',
      body: 'Phase 2 behind feature flag. Phase 1 sidesteps via /api/artifacts/.',
      order: 1,
    },
  }),
  ev({
    kind: 'plan_decision',
    payload: {
      plan_id: PLAN,
      parent_id: 'sec-deferred',
      title: 'ANT-as-ACP-server',
      body: 'Defer until ANT-as-ACP-client (M5) is validated.',
      order: 2,
    },
  }),
  ev({
    kind: 'plan_decision',
    payload: {
      plan_id: PLAN,
      parent_id: 'sec-deferred',
      title: 'Markdown-first storage',
      body: 'Considered (james storage thread) and rejected for canonical. Markdown stays a projection.',
      order: 3,
    },
  }),
];
