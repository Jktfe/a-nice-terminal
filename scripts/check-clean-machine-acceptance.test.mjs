import { describe, expect, it } from 'vitest';
import { buildPlan, renderPlan, CliInputError } from './check-clean-machine-acceptance.mjs';

describe('buildPlan', () => {
  it('throws without roomId', () => {
    expect(() => buildPlan({})).toThrow(CliInputError);
  });

  it('builds mac-only plan', () => {
    const plan = buildPlan({ roomId: 'room-1', os: 'mac' });
    expect(plan).toHaveLength(1);
    expect(plan[0].label).toBe('Mac CLI');
    expect(plan[0].osTag).toBe('mac');
    expect(plan[0].steps).toHaveLength(6);
  });

  it('builds win-only plan', () => {
    const plan = buildPlan({ roomId: 'room-1', os: 'win' });
    expect(plan).toHaveLength(1);
    expect(plan[0].label).toBe('Windows CLI');
    expect(plan[0].osTag).toBe('win');
  });

  it('builds both plan by default', () => {
    const plan = buildPlan({ roomId: 'room-1' });
    expect(plan).toHaveLength(2);
    expect(plan[0].label).toBe('Mac CLI');
    expect(plan[1].label).toBe('Windows CLI');
  });

  it('includes app sections when requested', () => {
    const plan = buildPlan({ roomId: 'room-1', os: 'both', includeApp: true });
    expect(plan).toHaveLength(4);
    expect(plan.map((s) => s.label)).toEqual([
      'Mac CLI', 'Windows CLI', 'Mac desktop app', 'Windows desktop app'
    ]);
  });

  it('includes topic and screenshotCmd per step', () => {
    const plan = buildPlan({ roomId: 'room-1', os: 'mac' });
    const step = plan[0].steps[0];
    expect(step.topic).toMatch(/^m6\.6-mac-/);
    expect(step.screenshotCmd).toContain('ant screenshot take room-1');
  });
});

describe('renderPlan', () => {
  it('renders mac plan', () => {
    const plan = buildPlan({ roomId: 'room-1', os: 'mac' });
    const rendered = renderPlan(plan);
    expect(rendered).toContain('Mac CLI');
    expect(rendered).toContain('Step 1');
    expect(rendered).toContain('ant --version');
    expect(rendered).toContain('ant screenshot take room-1');
  });

  it('renders both plan', () => {
    const plan = buildPlan({ roomId: 'room-1', os: 'both' });
    const rendered = renderPlan(plan);
    expect(rendered).toContain('Mac CLI');
    expect(rendered).toContain('Windows CLI');
  });

  it('renders empty sections as empty string', () => {
    const rendered = renderPlan([]);
    expect(rendered).toBe('');
  });
});
