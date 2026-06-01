#!/usr/bin/env node
/**
 * seed-ant-vnext-plan-mode-build — dogfood seed.
 *
 * Seeds plan_id `ant-vnext-plan-mode-build` with the §5 milestones from the
 * in-room Plan Mode Contract (PASS-confirmed read-only reference). Every
 * event is appended by calling handlePlanVerb from scripts/ant-cli-plan.mjs
 * (the baselined pm-cli-write surface) — not by hand-rolling POSTs. That
 * way every dogfood seed run exercises the same code path the operator
 * uses via `ant plan section ...` etc.
 *
 * The store is in-memory per pm-store baseline: server restart wipes data.
 * Re-running this script repopulates and is idempotent (identity-key
 * latest-wins keeps the projection clean).
 *
 * Usage:
 *   ANT_SERVER_URL=http://127.0.0.1:6174 node scripts/seed-ant-vnext-plan-mode-build.mjs
 */

import { handlePlanVerb } from './ant-cli-plan.mjs';

const PLAN_ID = 'ant-vnext-plan-mode-build';
const DEFAULT_SERVER_URL = process.env.ANT_SERVER_URL ?? 'http://127.0.0.1:6174';

class CliInputError extends Error {}

function makeRuntime() {
  return {
    fetchImpl: globalThis.fetch.bind(globalThis),
    serverUrl: DEFAULT_SERVER_URL,
    writeOut: (line) => console.log(line),
    writeErr: (line) => console.error(line)
  };
}

async function runVerb(verb, args, runtime) {
  return handlePlanVerb(verb, args, runtime, { CliInputError });
}

const SECTIONS = [
  ['Foundation', '1'],
  ['CLI surface', '2'],
  ['UI surface', '3'],
  ['Dogfood loop', '4'],
  ['Acceptance', '5']
];

const MILESTONES = [
  { id: 'pm-store', title: 'Backend store + projection', status: 'passing', owner: '@claude2' },
  { id: 'pm-endpoint', title: 'GET + POST endpoint with monotonic ts_millis', status: 'passing', owner: '@claude2' },
  { id: 'pm-cli-write', title: 'CLI write verbs (10) hitting POST', status: 'passing', owner: '@claude2' },
  { id: 'pm-cli-read', title: 'CLI show verb with --json + --include-archived', status: 'passing', owner: '@claude2' },
  { id: 'pm-route', title: 'SSR-first /plan-mode/[planId] route + PlanRoster', status: 'passing', owner: '@claude2' },
  { id: 'pm-components', title: 'PlanRoster split if it grows past cap', status: 'planned', owner: '@claude2' },
  { id: 'pm-dogfood-seed', title: 'Seed this very plan via CLI verbs', status: 'active', owner: '@claude2' },
  { id: 'pm-dogfood-update', title: 'Flip plan_test rows as later slices land', status: 'planned', owner: '@claude2' }
];

const ACCEPTANCE = { milestoneId: 'pm-dogfood-seed', id: 'pm-build-done', title: 'All foundation milestones land with tests passing' };

const TESTS = [
  { milestone: 'pm-store', title: 'pm-store-tests-green', status: 'passing' },
  { milestone: 'pm-endpoint', title: 'pm-endpoint-tests-green', status: 'passing' },
  { milestone: 'pm-cli-write', title: 'pm-cli-roundtrip-green', status: 'passing' },
  { milestone: 'pm-route', title: 'pm-route-ssr-green', status: 'passing' },
  { milestone: 'pm-route', title: 'pm-route-ws-green', status: 'planned' },
  { milestone: 'pm-components', title: 'pm-component-cap-green', status: 'passing' },
  { milestone: 'pm-dogfood-seed', title: 'pm-dogfood-self-rendering', status: 'planned' }
];

async function seedSections(runtime) {
  for (const [title, order] of SECTIONS) {
    await runVerb('section', [PLAN_ID, '--title', title, '--order', order], runtime);
  }
}

async function seedMilestones(runtime) {
  for (const milestone of MILESTONES) {
    await runVerb('milestone', [
      PLAN_ID,
      '--id', milestone.id,
      '--title', milestone.title,
      '--owner', milestone.owner,
      '--status', milestone.status
    ], runtime);
  }
}

async function seedAcceptance(runtime) {
  await runVerb('acceptance', [
    PLAN_ID,
    '--milestone', ACCEPTANCE.milestoneId,
    '--id', ACCEPTANCE.id,
    '--title', ACCEPTANCE.title
  ], runtime);
}

async function seedTests(runtime) {
  for (const test of TESTS) {
    await runVerb('test', [
      PLAN_ID,
      '--milestone', test.milestone,
      '--title', test.title,
      '--status', test.status
    ], runtime);
  }
}

async function main() {
  const runtime = makeRuntime();
  console.log(`Seeding ${PLAN_ID} against ${runtime.serverUrl}`);
  await seedSections(runtime);
  await seedMilestones(runtime);
  await seedAcceptance(runtime);
  await seedTests(runtime);
  const total = SECTIONS.length + MILESTONES.length + 1 + TESTS.length;
  console.log(`Done. Appended ${total} events. Inspect with: ant plan show ${PLAN_ID}`);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((failure) => {
    console.error(`Seed failed: ${failure.message ?? failure}`);
    process.exit(1);
  });
}

export { main, PLAN_ID, SECTIONS, MILESTONES, ACCEPTANCE, TESTS };
