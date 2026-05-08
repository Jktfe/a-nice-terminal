import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('PlanView render resilience', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/PlanView/PlanView.svelte'),
    'utf8',
  );

  it('does not gate milestone body rendering on a magic section slug only', () => {
    expect(source).toContain('return milestonesForSection(section).length > 0;');
    expect(source).toContain('{#if isMilestonesSection(section)}');
  });

  it('attaches milestones with stale parent ids to the first section of the same plan', () => {
    // Regression guard for plans where milestone.parent_id was emitted with
    // a section slug but the section event omitted acceptance_id. The rail
    // counted milestones, but the body rendered none.
    expect(source).toContain('function isFallbackMilestoneForSection(section: PlanEvent, milestone: PlanEvent): boolean');
    expect(source).toContain('that matches no section in the same plan');
    expect(source).toContain('if (hasMatchingSection) return false;');
    expect(source).toContain('firstSectionInPlan?.id === section.id');
  });

  it('does not double-render explicitly parented milestones in multi-section plans', () => {
    expect(source).toContain('eventAliases(e).includes(parentId)');
    expect(source).toContain('belongsTo(section, e) || isFallbackMilestoneForSection(section, e)');
  });

  it('keeps milestone status visibly colour-bound in the row', () => {
    expect(source).toContain('class="plan-mile-status"');
    expect(source).toContain('style="color: {statusColor(m.payload.status)};"');
  });

  it('reserves enough top padding to clear the fixed source bar', () => {
    // Regression guard for the "live bar is too close to the header" report
    // — the .plan-layout top padding must clear the fixed .plan-source bar
    // (top: 18px, ~32px tall) so the page header isn't crammed behind it.
    // 56px or smaller put the h1 directly under the bar.
    const layoutBlock = source.match(/\.plan-layout\s*{[\s\S]*?}/);
    expect(layoutBlock?.[0]).toBeDefined();
    const padding = layoutBlock?.[0].match(/padding:\s*(\d+)px/);
    expect(padding).toBeDefined();
    expect(Number(padding?.[1] ?? 0)).toBeGreaterThanOrEqual(80);
  });

  it('renders an overall plan-progress ProgressBar in the header', () => {
    expect(source).toContain("import ProgressBar from './ProgressBar.svelte';");
    expect(source).toMatch(/<header class="plan-head">[\s\S]*?<ProgressBar[\s\S]*?<\/header>/);
    // The format string must reflect milestone-count progress, not a raw %.
    expect(source).toMatch(/of \$\{totalMilestones\} milestones done/);
  });

  it('counts passing milestone states as complete in overall progress', () => {
    expect(source).toContain("return m.payload.status === 'done' || m.payload.status === 'passing';");
    expect(source).toContain('const doneCount = $derived(milestones.filter(isMilestoneDone).length);');
  });

  it('renders a section ProgressBar when the section has milestones', () => {
    expect(source).toMatch(/sectionProgress\(section\)\.total > 0/);
    expect(source).toMatch(/class="plan-section-progress"/);
  });

  it('renders a per-milestone test ProgressBar when tests exist', () => {
    expect(source).toMatch(/{#if tests\.length > 0}/);
    expect(source).toMatch(/class="plan-mile-tests-progress"/);
    expect(source).toMatch(/passing \/ tests\.length/);
  });

  it('renders tasks linked to a milestone inside the plan body', () => {
    expect(source).toContain('tasksForMilestone');
    expect(source).toContain('class="plan-linked-tasks"');
    expect(source).toContain('<h4>Linked Tasks</h4>');
  });

  it('renders a sidebar ProgressRing centred on overall percent', () => {
    expect(source).toContain("import ProgressRing from './ProgressRing.svelte';");
    expect(source).toMatch(/<aside class="plan-rail">[\s\S]*?<ProgressRing[\s\S]*?<\/aside>/);
    expect(source).toMatch(/value=\{overallPercent\}/);
  });
});

describe('Plan source bar discoverability', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/routes/plan/+page.svelte'),
    'utf8',
  );
  const dashboardHeaderSource = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/DashboardHeader.svelte'),
    'utf8',
  );
  const nocturneIconSource = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/NocturneIcon.svelte'),
    'utf8',
  );

  it('labels the archived toggle with discoverable text, not a single word', () => {
    // Regression guard for the "I cant see how to access archived" report —
    // the toggle previously showed bare "archived" buried in a 0.72-opacity
    // bar, which read as a status badge rather than an action. The label
    // must clearly describe the affordance.
    expect(source).toContain('Show archived plans');
  });

  it('renders archive toggle with a bordered chip so it stands out from source-bar text', () => {
    expect(source).toMatch(/\.plan-source-toggle[\s\S]*?border:\s*0\.5px solid currentColor/);
  });

  it('caps the source bar width so it does not span the whole canvas', () => {
    // Regression guard for "the top bar runs too wide" — at 1080px the bar
    // dominated the page and visually buried the controls. 720px cap keeps
    // it readable as a discrete control surface.
    const sourceBlock = source.match(/\.plan-source\s*{[\s\S]*?width:\s*min\((\d+)px/);
    expect(sourceBlock).toBeDefined();
    expect(Number(sourceBlock?.[1] ?? 9999)).toBeLessThanOrEqual(800);
  });

  it('exposes a plan-level archive/unarchive control in the source bar', () => {
    // Regression guard for "I cant see an option to archive / unarchive a
    // plan" — the archive action must be visible whenever a plan is
    // selected, not gated on edit mode + scrolling into section meta.
    expect(source).toContain('plan-source-archive');
    expect(source).toContain('toggleArchiveCurrentPlan');
    expect(source).toMatch(/archive plan|unarchive plan/);
  });

  it('clears every archived section identity from the top-bar unarchive control', () => {
    // Plan archive state is plan-wide: any latest section identity with
    // status=archived keeps the plan archived. The promoted top-bar control
    // must mirror the server/CLI rule by clearing all archived section
    // identities, not just the first one it finds.
    expect(source).toContain("sections.filter((e) => e.payload.status === 'archived')");
    expect(source).toContain('for (const section of targets)');
  });

  it('exposes an in-app back button for installed PWA plan views', () => {
    expect(source).toContain('function navigateBack()');
    expect(source).toContain("window.history.back()");
    expect(source).toContain("goto('/')");
    expect(source).toContain('class="plan-back"');
    expect(source).toContain('onclick={navigateBack}');
    expect(source).toContain('<span>Back</span>');
  });

  it('links the dashboard header to the plan surface', () => {
    expect(dashboardHeaderSource).toContain('href="/plan"');
    expect(dashboardHeaderSource).toContain('aria-label="Plans"');
    expect(dashboardHeaderSource).toContain('<NocturneIcon name="plan" size={18} />');
    expect(nocturneIconSource).toContain("name === 'plan'");
  });
});
