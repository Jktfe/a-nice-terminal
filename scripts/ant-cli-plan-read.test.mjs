import { describe, expect, it } from 'vitest';
import { runShowVerb } from './ant-cli-plan-read.mjs';

class CliInputError extends Error {}

function makeRuntime(projection) {
  const captured = { stdout: [], stderr: [] };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ events: projection }),
    text: async () => 'ok'
  });
  return {
    runtime: {
      fetchImpl,
      serverUrl: 'http://test.local',
      writeOut: (line) => captured.stdout.push(line),
      writeErr: (line) => captured.stderr.push(line)
    },
    captured
  };
}

function makeFailingRuntime(status, errorBody) {
  return {
    runtime: {
      fetchImpl: async () => ({
        ok: false,
        status,
        json: async () => ({}),
        text: async () => errorBody
      }),
      serverUrl: 'http://test.local',
      writeOut: () => {},
      writeErr: () => {}
    }
  };
}

const sampleProjection = [
  { id: 'sec-1', plan_id: 'plan-a', kind: 'plan_section', title: 'Foundation', order: 1, evidence: [] },
  { id: 'm-1', plan_id: 'plan-a', kind: 'plan_milestone', milestone_id: 'pm-store', title: 'Store', status: 'passing', owner: '@claude2', order: 2, evidence: [] },
  { id: 'a-1', plan_id: 'plan-a', kind: 'plan_acceptance', milestone_id: 'pm-store', acceptance_id: 'a-build', title: 'Build done', order: 3, evidence: [] },
  { id: 't-1', plan_id: 'plan-a', kind: 'plan_test', milestone_id: 'pm-store', title: 'Tests green', status: 'passing', order: 4, evidence: [] },
  { id: 'm-2', plan_id: 'plan-a', kind: 'plan_milestone', milestone_id: 'pm-old', title: 'Old store', status: 'archived', order: 5, evidence: [] }
];

describe('ant plan show', () => {
  it('R1: empty projection renders empty marker', async () => {
    const { runtime, captured } = makeRuntime([]);
    await runShowVerb('plan-a', {}, runtime, CliInputError);
    expect(captured.stdout).toContain('(no events)');
  });

  it('R2: sections / milestones / acceptance / tests render with kind + indent + status tags', async () => {
    const { runtime, captured } = makeRuntime(sampleProjection);
    await runShowVerb('plan-a', {}, runtime, CliInputError);
    const joined = captured.stdout.join('\n');
    expect(joined).toContain('plan_section');
    expect(joined).toContain('Foundation');
    expect(joined).toContain('plan_milestone [passing]');
    expect(joined).toContain('Store');
    expect(joined).toContain('plan_acceptance');
    expect(joined).toContain('plan_test [passing]');
    expect(joined).toContain('@claude2');
  });

  it('R3: --json dumps valid JSON of the visible projection', async () => {
    const { runtime, captured } = makeRuntime(sampleProjection);
    await runShowVerb('plan-a', { json: 'true' }, runtime, CliInputError);
    const out = captured.stdout.join('\n');
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed.events)).toBe(true);
    expect(parsed.events.some((event) => event.title === 'Foundation')).toBe(true);
  });

  it('R4: --include-archived shows archived events; default omits them', async () => {
    const noFlag = makeRuntime(sampleProjection);
    await runShowVerb('plan-a', {}, noFlag.runtime, CliInputError);
    expect(noFlag.captured.stdout.join('\n')).not.toContain('archived');
    expect(noFlag.captured.stdout.join('\n')).not.toContain('Old store');

    const withFlag = makeRuntime(sampleProjection);
    await runShowVerb('plan-a', { 'include-archived': 'true' }, withFlag.runtime, CliInputError);
    const joined = withFlag.captured.stdout.join('\n');
    expect(joined).toContain('[archived]');
    expect(joined).toContain('Old store');
  });

  it('R5: 200 passthrough preserves projection shape in --json output', async () => {
    const { runtime, captured } = makeRuntime(sampleProjection);
    await runShowVerb('plan-a', { json: 'true' }, runtime, CliInputError);
    const parsed = JSON.parse(captured.stdout.join('\n'));
    expect(parsed.events).toHaveLength(4);
    const milestone = parsed.events.find((event) => event.milestone_id === 'pm-store' && event.kind === 'plan_milestone');
    expect(milestone.owner).toBe('@claude2');
  });

  it('R6: server 500 surfaces as a thrown Error containing the status', async () => {
    const { runtime } = makeFailingRuntime(500, 'internal');
    let captured = null;
    try {
      await runShowVerb('plan-a', {}, runtime, CliInputError);
    } catch (failure) {
      captured = failure;
    }
    expect(captured).toBeTruthy();
    expect(captured.message).toContain('500');
  });

  it('R7: boolean flags --include-archived and --json parse without values via handlePlanVerb', async () => {
    const { handlePlanVerb } = await import('./ant-cli-plan.mjs');
    const { runtime, captured } = makeRuntime(sampleProjection);
    await handlePlanVerb('show', ['plan-a', '--include-archived', '--json'], runtime, { CliInputError });
    const out = captured.stdout.join('\n');
    const parsed = JSON.parse(out);
    expect(parsed.events).toHaveLength(5);
    expect(parsed.events.some((event) => event.status === 'archived')).toBe(true);
  });

  it('extra: empty planId throws CliInputError', async () => {
    const { runtime } = makeRuntime([]);
    let captured = null;
    try {
      await runShowVerb('', {}, runtime, CliInputError);
    } catch (failure) {
      captured = failure;
    }
    expect(captured).toBeInstanceOf(CliInputError);
  });
});
