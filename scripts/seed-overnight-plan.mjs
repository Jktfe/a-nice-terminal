#!/usr/bin/env node
/**
 * seed-overnight-plan — JWPK monitor surface for the overnight slice chain.
 *
 * Seeds plan_id `ant-vnext-overnight-2026-05-13` so /plan-mode/ant-vnext-overnight-2026-05-13
 * visibly shows the actual overnight progression: UI-CLEAN, CLI-TAIL, PTY-INJECT-0/A/B,
 * matcher-tune, live dogfood, PLAN-VISIBLE-SEEDER, rooms-persistence.
 *
 * POSTs directly to /api/plan/[planId] (same endpoint handlePlanVerb uses) so each
 * event can carry a ProvenanceRef (chat_message_id, source, author, section) for
 * JWPK click-through from milestone → source chat message.
 *
 * pm-store is in-memory so this seed must be re-run after every kickstart — invoke
 * via `bun run seed:overnight`. Identity-key (id) latest-wins keeps re-runs clean.
 */

const PLAN_ID = 'ant-vnext-overnight-2026-05-13';
const DEFAULT_SERVER_URL = process.env.ANT_SERVER_URL ?? 'http://127.0.0.1:6174';
const DEFAULT_AUTHOR = '@ant-cli';
const ANT_DEV_ROOM = 'antDevTeam-2026-05-13';

export function makeRuntime(overrides = {}) {
  return {
    fetchImpl: overrides.fetchImpl ?? globalThis.fetch.bind(globalThis),
    serverUrl: overrides.serverUrl ?? DEFAULT_SERVER_URL,
    writeOut: overrides.writeOut ?? ((line) => console.log(line)),
    writeErr: overrides.writeErr ?? ((line) => console.error(line))
  };
}

function makeEventId(kindHint, identityKey) {
  const random = Math.random().toString(36).slice(2, 8);
  return `evt-${PLAN_ID}-${kindHint}-${identityKey}-${Date.now()}-${random}`;
}

async function postEvent(runtime, body) {
  const response = await runtime.fetchImpl(
    `${runtime.serverUrl}/api/plan/${encodeURIComponent(PLAN_ID)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`POST /api/plan/${PLAN_ID} ${response.status}: ${text.slice(0, 200)}`);
  }
  const parsed = await response.json();
  runtime.writeOut(`${parsed.event.id}\t${parsed.event.kind}${parsed.event.status ? '\t' + parsed.event.status : ''}`);
  return parsed.event;
}

export const SECTIONS = [
  { title: 'Foundation', order: 1 },
  { title: 'Identity',   order: 2 },
  { title: 'Injection',  order: 3 },
  { title: 'Dogfood',    order: 4 },
  { title: 'Followups',  order: 5 }
];

export const MILESTONES = [
  { id: 'ui-clean',            title: 'UI-CLEAN — root + rooms cockpit drop',            status: 'passing', owner: '@claude2',     section: 'Foundation' },
  { id: 'cli-tail',            title: 'CLI-TAIL — ant chat tail verb',                   status: 'passing', owner: '@claude2',     section: 'Foundation' },
  { id: 'pty-inject-0',        title: 'PTY-INJECT-0 design contract',                    status: 'passing', owner: '@researchant', section: 'Identity' },
  { id: 'pty-inject-a',        title: 'PTY-INJECT-A — identity + register + memberships', status: 'passing', owner: '@claude2',     section: 'Identity' },
  { id: 'pty-inject-b',        title: 'PTY-INJECT-B — tmux fanout + paste+Enter',        status: 'passing', owner: '@claude2',     section: 'Injection' },
  { id: 'matcher-tune',        title: 'Matcher tune — claude_code ❯ prompt recognition', status: 'passing', owner: '@claude2',     section: 'Injection' },
  { id: 'live-dogfood',        title: 'Live dogfood on :6174 ant-build',                 status: 'passing', owner: '@claude2',     section: 'Dogfood' },
  { id: 'plan-visible-seeder', title: 'PLAN-VISIBLE seeder script for monitor surface',   status: 'active',  owner: '@claude2',     section: 'Followups' },
  { id: 'rooms-persistence',   title: 'Rooms/messages persistence (kickstart-survival)', status: 'planned', owner: 'unassigned',   section: 'Followups' }
];

export const ACCEPTANCE = {
  milestoneId: 'plan-visible-seeder',
  id: 'plan-visible-monitor-live',
  title: '/plan-mode/ant-vnext-overnight-2026-05-13 renders all completed milestones with PASS'
};

export const TESTS = [
  { milestone: 'ui-clean',            title: 'ui-clean-bun-test-green',               status: 'passing' },
  { milestone: 'cli-tail',            title: 'cli-tail-tail-once-green',              status: 'passing' },
  { milestone: 'pty-inject-0',        title: 'pty-inject-0-design-v2-passed',         status: 'passing' },
  { milestone: 'pty-inject-a',        title: 'pty-inject-a-real-shell-roundtrip',     status: 'passing' },
  { milestone: 'pty-inject-a',        title: 'pty-inject-a-persistence-restart',      status: 'passing' },
  { milestone: 'pty-inject-b',        title: 'pty-inject-b-bridge-stale-marker',      status: 'passing' },
  { milestone: 'pty-inject-b',        title: 'pty-inject-b-fanout-recursion-lockout', status: 'passing' },
  { milestone: 'pty-inject-b',        title: 'pty-inject-b-compound-queue-key',       status: 'passing' },
  { milestone: 'matcher-tune',        title: 'matcher-tune-chevron-recognised',       status: 'passing' },
  { milestone: 'live-dogfood',        title: 'live-dogfood-sentinel-landed-in-pane',  status: 'passing' },
  { milestone: 'plan-visible-seeder', title: 'plan-visible-seeder-roundtrip',         status: 'active' },
  { milestone: 'rooms-persistence',   title: 'rooms-persistence-design-pending',      status: 'planned' }
];

function makeProvenance(owner, section) {
  return { source: ANT_DEV_ROOM, author: owner, section };
}

export async function seedSections(runtime) {
  for (const section of SECTIONS) {
    await postEvent(runtime, {
      id: makeEventId('section', section.title.toLowerCase()),
      plan_id: PLAN_ID,
      kind: 'plan_section',
      title: section.title,
      order: section.order,
      author_handle: DEFAULT_AUTHOR,
      author_kind: 'agent',
      provenance: { source: ANT_DEV_ROOM, author: '@evolveantclaude', section: section.title }
    });
  }
}

export async function seedMilestones(runtime) {
  for (const milestone of MILESTONES) {
    await postEvent(runtime, {
      id: makeEventId('milestone', milestone.id),
      plan_id: PLAN_ID,
      kind: 'plan_milestone',
      milestone_id: milestone.id,
      title: milestone.title,
      status: milestone.status,
      owner: milestone.owner,
      order: 0,
      author_handle: DEFAULT_AUTHOR,
      author_kind: 'agent',
      provenance: makeProvenance(milestone.owner, milestone.section)
    });
  }
}

export async function seedAcceptance(runtime) {
  await postEvent(runtime, {
    id: makeEventId('acceptance', ACCEPTANCE.id),
    plan_id: PLAN_ID,
    kind: 'plan_acceptance',
    milestone_id: ACCEPTANCE.milestoneId,
    acceptance_id: ACCEPTANCE.id,
    title: ACCEPTANCE.title,
    order: 0,
    author_handle: DEFAULT_AUTHOR,
    author_kind: 'agent',
    provenance: { source: ANT_DEV_ROOM, author: '@evolveantcodex', section: 'Followups' }
  });
}

export async function seedTests(runtime) {
  for (const test of TESTS) {
    await postEvent(runtime, {
      id: makeEventId('test', `${test.milestone}-${test.title}`),
      plan_id: PLAN_ID,
      kind: 'plan_test',
      milestone_id: test.milestone,
      title: test.title,
      status: test.status,
      order: 0,
      author_handle: DEFAULT_AUTHOR,
      author_kind: 'agent',
      provenance: { source: ANT_DEV_ROOM, author: '@claude2', section: 'Tests' }
    });
  }
}

export async function main(overrides = {}) {
  const runtime = makeRuntime(overrides);
  runtime.writeOut(`Seeding ${PLAN_ID} against ${runtime.serverUrl}`);
  await seedSections(runtime);
  await seedMilestones(runtime);
  await seedAcceptance(runtime);
  await seedTests(runtime);
  const total = SECTIONS.length + MILESTONES.length + 1 + TESTS.length;
  runtime.writeOut(`Done. Appended ${total} events. Inspect: ${runtime.serverUrl}/plan-mode/${PLAN_ID}`);
  return total;
}

export { PLAN_ID };

const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main().catch((failure) => {
    console.error(`Seed failed: ${failure.message ?? failure}`);
    process.exit(1);
  });
}
