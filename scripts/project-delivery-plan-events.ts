import getDb, { queries } from '../src/lib/server/db.js';
import type { PlanEventPayload, PlanStatus } from '../src/lib/server/projector/types.js';

const SESSION_ID = 'ant-delivery-plan-2026-05-05';
const PLAN_ID = 'ant-delivery-2026-05-05';
const BASE_TS = Date.now();

type PlanKind =
  | 'plan_section'
  | 'plan_decision'
  | 'plan_milestone'
  | 'plan_acceptance'
  | 'plan_test';

type EventInput = {
  kind: PlanKind;
  text: string;
  payload: PlanEventPayload;
};

function source(section: string) {
  return {
    fallback: {
      source: 'docs/ant-delivery-plan-2026-05-05.md',
      author: 'codexant',
      section,
    },
  };
}

function fileEvidence(label = 'delivery plan') {
  return [{ kind: 'file' as const, ref: 'docs/ant-delivery-plan-2026-05-05.md', label }];
}

function section(id: string, title: string, body: string, order: number): EventInput {
  return {
    kind: 'plan_section',
    text: title,
    payload: {
      plan_id: PLAN_ID,
      title,
      body,
      order,
      acceptance_id: id,
      provenance: [source(title)],
    },
  };
}

function decision(parentId: string, title: string, body: string, order: number): EventInput {
  return {
    kind: 'plan_decision',
    text: title,
    payload: {
      plan_id: PLAN_ID,
      parent_id: parentId,
      title,
      body,
      order,
      provenance: [source(parentId)],
    },
  };
}

function milestone(
  id: string,
  title: string,
  body: string,
  order: number,
  owner: string,
  status: PlanStatus,
): EventInput {
  return {
    kind: 'plan_milestone',
    text: title,
    payload: {
      plan_id: PLAN_ID,
      parent_id: 'sec-milestones',
      title,
      body,
      order,
      milestone_id: id,
      owner,
      status,
      evidence: fileEvidence(),
      provenance: [source('Milestones')],
    },
  };
}

function acceptance(id: string, milestoneId: string, title: string, body: string): EventInput {
  return {
    kind: 'plan_acceptance',
    text: title,
    payload: {
      plan_id: PLAN_ID,
      parent_id: milestoneId,
      title,
      body,
      order: 1,
      milestone_id: milestoneId,
      acceptance_id: id,
      provenance: [source(milestoneId)],
    },
  };
}

function test(
  milestoneId: string,
  title: string,
  order: number,
  status: PlanStatus = 'planned',
): EventInput {
  return {
    kind: 'plan_test',
    text: title,
    payload: {
      plan_id: PLAN_ID,
      parent_id: milestoneId,
      title,
      order,
      status,
      milestone_id: milestoneId,
      evidence: fileEvidence('plan source'),
      provenance: [source(milestoneId)],
    },
  };
}

const events: EventInput[] = [
  section('sec-thesis', 'Delivery thesis', 'repeatable loop · visible trust · local control', 1),
  section('sec-boundary', 'Product boundary', 'what ANT is and is not', 2),
  section('sec-decisions', 'Plan decisions', 'sequencing decisions folded from room critique', 3),
  section('sec-milestones', 'Milestones', '6-8 weeks · ordered · with measurable acceptance', 4),
  section('sec-progress', 'Progress reports', 'execution log · updated as work moves', 5),
  section('sec-not-now', 'Not now', 'explicit non-goals for this delivery pass', 6),

  decision(
    'sec-thesis',
    'Plan View is the presentation surface.',
    'The markdown delivery plan remains the source, but the presentable operating plan belongs in live plan_* events rendered by /plan.',
    1,
  ),
  decision(
    'sec-thesis',
    'James approved the delivery plan on 2026-05-05.',
    'Move from planning to execution, starting with M1: operating loop and capture coverage.',
    2,
  ),
  decision(
    'sec-boundary',
    'Remote agents never write to another person\'s machine.',
    'Cross-machine collaboration is shared artifacts, shared git through normal team boundaries, and remote feedback.',
    1,
  ),
  decision(
    'sec-boundary',
    'Shared artifacts are advisory by default.',
    'Local application of shared suggestions requires local-owner approval. This prevents shared docs from becoming remote execution with extra steps.',
    2,
  ),
  decision(
    'sec-decisions',
    'Capture coverage comes before consent gates.',
    'If the pipeline misses prompts or private-context reveals, the trust layer fires at the wrong time. Week 1 measures and fixes the top gaps.',
    1,
  ),
  decision(
    'sec-decisions',
    'Consent is scope-of-grant, not per-query.',
    'A usable grant has topic, source set, time window, and answer count. Per-query consent at high frequency will be disabled.',
    2,
  ),
  decision(
    'sec-decisions',
    'Transport moves into Week 3.',
    'Stevo and GVPL pilots need authenticated cross-machine room transport and cross-machine @handle routing before Week 4.',
    3,
  ),
  decision(
    'sec-decisions',
    'OSS readiness is a 6-8 week gate.',
    'Four weeks proves the loop and pilots. Public OSS requires install, docs, security model, tests, and contributor workflow.',
    4,
  ),

  milestone('M1', 'Operating loop and capture coverage', 'Week 1 · claims, status digest, agent roster', 1, '@codexant', 'active'),
  acceptance(
    'M1-acc',
    'M1',
    'The room has a visible operating loop.',
    'A room shows lead claim, TTL, status, open asks, stale agents, running tasks, latest artifacts, and capture coverage from a known scripted run.',
  ),
  test('M1', 'Capture-coverage baseline covers prompts, asks, plans, file writes, artifact writes, screenshots, run status, and failures.', 1, 'planned'),
  test('M1', 'Room header and ant room status expose the same lead claim fields: handle, role, TTL, and status text.', 2, 'planned'),
  test('M1', 'Agent roster lists Kimi, GLM, DeepSeek, Qwen candidate, Gemini, Claude, Codex, and local profiles.', 3, 'planned'),

  milestone('M2', 'Interview Mode MVP', 'Week 2 · side chat, notes, publish back', 2, '@claudeant + @codexant', 'planned'),
  acceptance(
    'M2-acc',
    'M2',
    'A side interview becomes a sourced room summary.',
    'James can run a five-minute side conversation, interrupt visibly, and publish findings, decisions, asks, actions, sources, and transcript link back to the origin room.',
  ),
  test('M2', 'Start interview from agent card or room mention creates or focuses a linked side chat.', 1),
  test('M2', 'Publish summary posts findings, decisions, asks, actions, sources, and transcript link to the origin room.', 2),
  test('M2', 'Interrupt intent records original_prompt, partial_output, and interrupt_message as structured input.', 3),

  milestone('M3', 'Shared artifact trust', 'Week 3 · ask protocol, transport, consent, provenance, conflicts', 3, '@codexant + @claudeant', 'planned'),
  acceptance(
    'M3-acc',
    'M3',
    'Shared artifacts are safe enough for team use.',
    'A scoped ask routes to a peer machine, private-context reveal uses a bounded grant, answers carry bidirectional provenance, and stale artifact edits open a conflict lane.',
  ),
  test('M3', 'Authenticated cross-machine room transport routes a scoped ask to a peer machine and returns a response.', 1),
  test('M3', 'Scope-of-grant consent supports topic, source set, duration, and answer count.', 2),
  test('M3', 'Artifact conflict lane records path/region, base hash, proposed change, current change, and participants.', 3),

  milestone('M4', 'Cross-machine pilots', 'Week 4 · Stevo/docs and GVPL/code', 4, '@claudeant + @codexant + critics', 'planned'),
  acceptance(
    'M4-acc',
    'M4',
    'Both pilots complete without remote shell access.',
    'Stevo/docs lands a sourced private-context answer in a shared artifact; GVPL/code gets useful teammate-side feedback without the teammate agent writing to the owner machine.',
  ),
  test('M4', 'Stevo/docs: receiving side deliberately accepts, rejects, or asks follow-up on the sourced answer.', 1),
  test('M4', 'GVPL/code: owner-side agent edits owner clone; teammate-side agent contributes requirements, logs, screenshots, config findings, and acceptance.', 2),
  test('M4', 'Pilot retro doc has at least five specific action items tied to captured pilot events.', 3),

  milestone('M5', 'OSS readiness gate', 'Weeks 5-8 · install, docs, security, tests, contributors', 5, '@codexant + @claudeant', 'planned'),
  acceptance(
    'M5-acc',
    'M5',
    'A second technical user can complete a sourced artifact workflow.',
    'Install, launch two known agents, join a room, complete a sourced artifact workflow, and understand security defaults without James hand-holding.',
  ),
  test('M5', 'Installer and setup docs exist with stable vs lab separation.', 1),
  test('M5', 'Security model documents local, shared artifact, and shared repo modes with fail-closed defaults.', 2),
  test('M5', 'End-to-end tests cover first slice, Interview Mode MVP, and shared artifact trust.', 3),

  milestone('M6', 'Parallel stable-track polish', 'Weeks 1-4 parallel · visual QA and PWA cockpit', 6, '@gemini + @codexant', 'planned'),
  acceptance(
    'M6-acc',
    'M6',
    'Visual and mobile polish improve without blocking pilots.',
    'Deck/UI visual QA has screenshot checks and design-system criteria; PWA/mobile fixes target operator-friction findings without delaying Stevo/GVPL pilots.',
  ),
  test('M6', 'Visual QA baseline catches overflow, legibility, responsive issues, and design-system drift.', 1),
  test('M6', 'PWA/mobile cockpit surfaces active, blocked, stale, and done agents with fewer navigation hops.', 2),

  decision(
    'sec-progress',
    '2026-05-05 13:20 Europe/London: Plan approved by James; M1 is active.',
    'Delivery moved from planning to execution. First active milestone is M1: operating loop and capture coverage.',
    1,
  ),
  decision(
    'sec-progress',
    '2026-05-05 13:25 Europe/London: Progress-report protocol agreed.',
    'Live Plan View will carry concise progress entries as execution moves; ANT chat will carry short notifications.',
    2,
  ),
  decision(
    'sec-progress',
    '2026-05-05 13:31 Europe/London: Main :6458 server rebuilt and bounced.',
    'Verified health, Plan scroll/light/progress, Asks Needs Action filter, workspace-file source link, and deck token redirect.',
    3,
  ),

  decision(
    'sec-not-now',
    'Do not build full remote execution federation now.',
    'No microVM-everything architecture, marketplace, full CRDT canvas, full voice/audio stack, or PTY interruption for every agent in this delivery pass.',
    1,
  ),
];

const db = getDb();
db.prepare('INSERT OR IGNORE INTO sessions (id, name, type) VALUES (?, ?, ?)').run(
  SESSION_ID,
  'ANT delivery plan 2026-05-05',
  'chat',
);
db.prepare("UPDATE sessions SET name = ?, type = ?, updated_at = datetime('now') WHERE id = ?").run(
  'ANT delivery plan 2026-05-05',
  'chat',
  SESSION_ID,
);
db.prepare(
  "DELETE FROM run_events WHERE session_id = ? AND kind LIKE 'plan_%' AND JSON_VALID(payload) AND JSON_EXTRACT(payload, '$.plan_id') = ?",
).run(SESSION_ID, PLAN_ID);

events.forEach((event, index) => {
  queries.appendRunEvent(
    SESSION_ID,
    BASE_TS + index,
    'json',
    'high',
    event.kind,
    event.text,
    JSON.stringify(event.payload),
    null,
  );
});

console.log(`Projected ${events.length} plan events`);
console.log(`/plan?session_id=${encodeURIComponent(SESSION_ID)}&plan_id=${encodeURIComponent(PLAN_ID)}`);
