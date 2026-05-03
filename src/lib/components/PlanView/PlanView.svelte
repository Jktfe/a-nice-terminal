<script lang="ts">
  import { NOCTURNE, surfaceTokens } from '$lib/nocturne';
  import {
    type PlanEvent,
    type PlanStatus,
    type ProvenanceRef,
    resolveProvenance,
  } from './types';

  let {
    events,
    title = 'ANT — Plan',
    subtitle,
    themeMode = 'dark',
  }: {
    events: PlanEvent[];
    title?: string;
    subtitle?: string;
    themeMode?: 'dark' | 'light';
  } = $props();

  const s = $derived(surfaceTokens(themeMode));
  const isDark = $derived(themeMode === 'dark');

  // ── Group helpers ──────────────────────────────────────────────────────
  const sections = $derived(
    events
      .filter((e) => e.kind === 'plan_section')
      .sort((a, b) => a.payload.order - b.payload.order),
  );

  function slug(value: string | undefined): string {
    return (value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function eventAliases(event: PlanEvent): string[] {
    return Array.from(
      new Set([
        event.id,
        event.payload.title,
        slug(event.payload.title),
        event.payload.milestone_id,
        event.payload.acceptance_id,
      ].filter((value): value is string => Boolean(value))),
    );
  }

  function belongsTo(parent: PlanEvent, child: PlanEvent): boolean {
    const parentId = child.payload.parent_id;
    if (!parentId) return false;
    return eventAliases(parent).includes(parentId);
  }

  function isMilestonesSection(section: PlanEvent): boolean {
    const aliases = eventAliases(section);
    return aliases.includes('sec-milestones') || aliases.includes('milestones');
  }

  function decisionsForSection(section: PlanEvent) {
    return events
      .filter((e) => e.kind === 'plan_decision' && belongsTo(section, e))
      .sort((a, b) => a.payload.order - b.payload.order);
  }

  function milestonesForSection(section: PlanEvent) {
    return events
      .filter((e) => e.kind === 'plan_milestone' && belongsTo(section, e))
      .sort((a, b) => a.payload.order - b.payload.order);
  }

  function acceptanceFor(milestoneId: string) {
    return events.find(
      (e) => e.kind === 'plan_acceptance' && e.payload.milestone_id === milestoneId,
    );
  }

  function testsFor(milestoneId: string) {
    return events
      .filter((e) => e.kind === 'plan_test' && e.payload.milestone_id === milestoneId)
      .sort((a, b) => a.payload.order - b.payload.order);
  }

  // ── Status colour mapping (R4 §3d motion: subtle, meaningful) ─────────
  function statusColor(status: PlanStatus | undefined): string {
    if (status === 'active') return isDark ? NOCTURNE.amber[400] : NOCTURNE.amber[600];
    if (status === 'done' || status === 'passing')
      return isDark ? NOCTURNE.emerald[400] : NOCTURNE.emerald[600];
    if (status === 'failing' || status === 'blocked') return NOCTURNE.semantic.danger;
    return s.textFaint;
  }

  function statusLabel(status: PlanStatus | undefined): string {
    return status ?? 'planned';
  }

  // ── Side rail (derived projection per §6.5; NOT plan_* events) ────────
  const milestones = $derived(events.filter((e) => e.kind === 'plan_milestone'));
  const liveMilestone = $derived(milestones.find((m) => m.payload.status === 'active'));
  const doneCount = $derived(milestones.filter((m) => m.payload.status === 'done').length);
  const queuedCount = $derived(
    milestones.filter((m) => m.payload.status === 'planned' || !m.payload.status).length,
  );
  const ownerHandles = $derived(
    Array.from(
      new Set(milestones.map((m) => m.payload.owner).filter((o): o is string => Boolean(o))),
    ),
  );

  // ── Render-time stat ──────────────────────────────────────────────────
  const sectionCount = $derived(sections.length);
  const ownerCount = $derived(ownerHandles.length);
  const headerSubtitle = $derived(
    subtitle ??
      `R4 Decision Output · ${ownerCount} agents · ${sectionCount} sections · derived from plan_* events`,
  );
</script>

<div
  class="plan"
  data-theme={themeMode}
  style="
    --plan-bg: {isDark ? NOCTURNE.ink[900] : NOCTURNE.neutral[50]};
    --plan-surface: {isDark ? NOCTURNE.ink[800] : '#FFFFFF'};
    --plan-surface-hover: {isDark ? NOCTURNE.ink[700] : NOCTURNE.neutral[100]};
    --plan-border: {s.hairline};
    --plan-border-strong: {s.hairlineStrong};
    --plan-text: {s.text};
    --plan-text-muted: {s.textMuted};
    --plan-text-faint: {s.textFaint};
    --plan-link: {isDark ? NOCTURNE.blue[300] : NOCTURNE.blue[600]};
  "
>
  <div class="plan-layout">
    <header class="plan-head">
      <h1>{title}</h1>
      <p class="plan-subtitle">{headerSubtitle}</p>
    </header>

    <main class="plan-main">
      {#each sections as section (section.id)}
        <section class="plan-section" id={section.id}>
          <div class="plan-section-head">
            <h2>{section.payload.title}</h2>
            {#if section.payload.body}
              <span class="plan-section-meta">{section.payload.body}</span>
            {/if}
          </div>

          {#if isMilestonesSection(section)}
            <div class="plan-milestones">
              {#each milestonesForSection(section) as m (m.id)}
                {@const acc = acceptanceFor(m.payload.milestone_id ?? m.id)}
                {@const tests = testsFor(m.payload.milestone_id ?? m.id)}
                <details class="plan-milestone" data-status={m.payload.status ?? 'planned'}>
                  <summary>
                    <span class="plan-status-dot" style="background: {statusColor(m.payload.status)};"></span>
                    <span class="plan-mile-label">
                      <span class="plan-mile-id">{m.payload.milestone_id ?? m.id}</span>
                      <span class="plan-mile-title">{m.payload.title}</span>
                    </span>
                    <span class="plan-mile-meta">
                      {#if m.payload.body}<span>{m.payload.body}</span>{/if}
                      {#if m.payload.owner}<span class="plan-mile-owner">{m.payload.owner}</span>{/if}
                      <span class="plan-mile-status">{statusLabel(m.payload.status)}</span>
                    </span>
                  </summary>
                  <div class="plan-mile-body">
                    {#if acc}
                      <h4>Acceptance</h4>
                      <blockquote class="plan-acceptance">{acc.payload.body ?? acc.payload.title}</blockquote>
                    {/if}
                    {#if tests.length}
                      <h4>Tests</h4>
                      <ul class="plan-tests">
                        {#each tests as t (t.id)}
                          <li data-state={t.payload.status ?? 'planned'}>
                            <span class="plan-test-mark" style="color: {statusColor(t.payload.status)};">
                              {#if t.payload.status === 'passing' || t.payload.status === 'done'}✓{:else if t.payload.status === 'failing'}✗{:else}·{/if}
                            </span>
                            <span class="plan-test-label">{t.payload.title}</span>
                            {#if t.payload.evidence?.length}
                              <span class="plan-test-evidence">
                                {#each t.payload.evidence as ev}
                                  <a href={ev.kind === 'file' ? `/${ev.ref}` : `#${ev.ref}`} class="plan-link">{ev.label ?? ev.ref}</a>
                                {/each}
                              </span>
                            {/if}
                          </li>
                        {/each}
                      </ul>
                    {/if}
                    {#if m.payload.evidence?.length}
                      <div class="plan-mile-links">
                        {#each m.payload.evidence as ev}
                          <a href={ev.kind === 'file' ? `/${ev.ref}` : `#${ev.ref}`} class="plan-link">{ev.label ?? ev.ref}</a>
                        {/each}
                      </div>
                    {/if}
                    {#if m.payload.provenance?.length}
                      {@render provenanceLine(m.payload.provenance)}
                    {/if}
                  </div>
                </details>
              {/each}
            </div>
          {:else}
            {@const decisions = decisionsForSection(section)}
            {#if decisions.length}
              <ul class="plan-decisions">
                {#each decisions as d, i (d.id)}
                  <li>
                    <span class="plan-decision-marker">{String.fromCharCode(97 + i)}</span>
                    <div class="plan-decision-body">
                      <strong>{d.payload.title}</strong>
                      {#if d.payload.body}
                        <span class="plan-decision-text"> {d.payload.body}</span>
                      {/if}
                      {#if d.payload.provenance?.length}
                        {@render provenanceLine(d.payload.provenance)}
                      {/if}
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
          {/if}
        </section>
      {/each}
    </main>

    <aside class="plan-rail">
      <div class="plan-rail-group">
        <h3>Live</h3>
        {#if liveMilestone}
          <div class="plan-rail-row plan-rail-row--active">
            <span class="plan-rail-dot" style="background: {statusColor('active')};"></span>
            <span class="plan-rail-label">{liveMilestone.payload.milestone_id} · {liveMilestone.payload.title}</span>
          </div>
        {/if}
        <div class="plan-rail-row">
          <span class="plan-rail-dot"></span>
          <span class="plan-rail-label">{queuedCount} queued</span>
        </div>
      </div>

      <div class="plan-rail-group">
        <h3>Recent</h3>
        <div class="plan-rail-row plan-rail-row--done">
          <span class="plan-rail-dot" style="background: {statusColor('done')};"></span>
          <span class="plan-rail-label">{doneCount} milestones done</span>
        </div>
      </div>

      <div class="plan-rail-group">
        <h3>Owners</h3>
        {#each ownerHandles as h}
          <div class="plan-rail-row">
            <span class="plan-rail-dot"></span>
            <span class="plan-rail-label">{h}</span>
          </div>
        {/each}
      </div>
    </aside>
  </div>
</div>

{#snippet provenanceLine(prov: ProvenanceRef[])}
  <span class="plan-provenance">
    {#each prov as p, i}
      {@const r = resolveProvenance(p)}
      {#if i > 0}<span class="plan-prov-sep"> · </span>{/if}
      {#if r.state === 'exact' && r.href}
        <a href={r.href} class="plan-link plan-prov-link">{r.label}</a>
      {:else if r.state === 'fallback'}
        <span class="plan-prov-fallback" title={r.hint ?? ''}>{r.label}</span>
      {:else}
        <span class="plan-prov-unresolved" title="provenance unresolved">{r.label}</span>
      {/if}
    {/each}
  </span>
{/snippet}

<style>
  .plan {
    background: var(--plan-bg);
    color: var(--plan-text);
    min-height: 100vh;
    font: 14px/1.55 var(--font-sans, -apple-system, system-ui, sans-serif);
    -webkit-font-smoothing: antialiased;
  }
  .plan-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 220px;
    gap: 48px;
    max-width: 1080px;
    margin: 0 auto;
    padding: 56px 32px 120px;
  }

  /* Header */
  .plan-head {
    grid-column: 1 / -1;
    border-bottom: 1px solid var(--plan-border);
    padding-bottom: 24px;
    margin-bottom: 16px;
  }
  .plan-head h1 {
    font-size: 22px;
    font-weight: 500;
    margin: 0;
    letter-spacing: -0.01em;
  }
  .plan-subtitle {
    color: var(--plan-text-muted);
    font-size: 13px;
    margin: 6px 0 0;
  }

  /* Main column */
  .plan-main { min-width: 0; }
  .plan-section { margin-bottom: 44px; }
  .plan-section-head {
    position: sticky;
    top: 0;
    background: linear-gradient(to bottom, var(--plan-bg) 70%, transparent);
    padding: 16px 0 10px;
    margin: 0 0 14px;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    z-index: 5;
  }
  .plan-section-head h2 {
    font-size: 16px;
    font-weight: 500;
    margin: 0;
    letter-spacing: -0.005em;
  }
  .plan-section-meta {
    color: var(--plan-text-faint);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  /* Decision rows */
  .plan-decisions {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
  }
  .plan-decisions li {
    padding: 10px 0;
    border-bottom: 1px solid var(--plan-border);
    display: flex;
    gap: 12px;
    align-items: baseline;
  }
  .plan-decisions li:last-child { border-bottom: none; }
  .plan-decision-marker {
    flex: 0 0 auto;
    color: var(--plan-text-faint);
    font-family: var(--font-mono);
    font-size: 12px;
    width: 18px;
  }
  .plan-decision-body { flex: 1 1 auto; min-width: 0; }
  .plan-decision-body strong {
    font-weight: 500;
    color: var(--plan-text);
  }
  .plan-decision-text {
    color: var(--plan-text-muted);
  }

  /* Provenance footnote */
  .plan-provenance {
    display: block;
    font-size: 12px;
    color: var(--plan-text-faint);
    margin-top: 4px;
  }
  .plan-prov-sep { color: var(--plan-text-faint); }
  .plan-prov-link {
    color: var(--plan-link);
    text-decoration: none;
    border-bottom: 1px dotted var(--plan-text-faint);
  }
  .plan-prov-link:hover { color: var(--plan-text); }
  .plan-prov-fallback {
    color: var(--plan-text-muted);
    border-bottom: 1px dashed var(--plan-text-faint);
  }
  .plan-prov-unresolved {
    color: var(--plan-text-faint);
    border-bottom: 1px dashed var(--plan-text-faint);
    text-decoration: line-through;
    text-decoration-color: rgba(255, 100, 100, 0.5);
    font-style: italic;
  }

  /* Milestone cards */
  .plan-milestones {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .plan-milestone {
    background: var(--plan-surface);
    border: 1px solid var(--plan-border);
    border-radius: 6px;
    padding: 0;
    transition: border-color 200ms ease;
  }
  .plan-milestone:hover { border-color: var(--plan-border-strong); }
  .plan-milestone[open] { border-color: var(--plan-border-strong); }
  .plan-milestone summary {
    list-style: none;
    cursor: pointer;
    padding: 14px 18px;
    display: grid;
    grid-template-columns: auto minmax(220px, 0.8fr) minmax(260px, 1.2fr);
    gap: 14px;
    align-items: baseline;
  }
  .plan-milestone summary::-webkit-details-marker { display: none; }
  .plan-milestone summary::marker { display: none; }
  .plan-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    align-self: center;
    flex-shrink: 0;
  }
  .plan-milestone[data-status='active'] .plan-status-dot {
    box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.12);
    animation: plan-pulse 2.4s ease-in-out infinite;
  }
  @keyframes plan-pulse {
    0%, 100% { box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.12); }
    50%      { box-shadow: 0 0 0 7px rgba(245, 158, 11, 0.04); }
  }
  .plan-mile-label {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    font-size: 14px;
    color: var(--plan-text);
  }
  .plan-mile-id {
    flex: 0 0 auto;
    color: var(--plan-text-muted);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .plan-mile-title {
    min-width: 0;
    overflow-wrap: normal;
  }
  .plan-mile-meta {
    display: flex;
    align-items: baseline;
    justify-content: flex-end;
    gap: 10px;
    min-width: 0;
    color: var(--plan-text-faint);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .plan-mile-meta > span:first-child {
    min-width: 0;
    max-width: 46ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .plan-mile-owner {
    flex: 0 0 auto;
    color: var(--plan-link);
    font-family: var(--font-mono);
    white-space: nowrap;
  }
  .plan-mile-status {
    flex: 0 0 auto;
    color: var(--plan-text-faint);
    font-family: var(--font-mono);
    text-transform: uppercase;
    font-size: 10.5px;
    letter-spacing: 0.04em;
  }

  .plan-mile-body {
    padding: 14px 18px 18px 56px;
    border-top: 1px solid var(--plan-border);
  }
  .plan-mile-body h4 {
    font-size: 12px;
    font-weight: 500;
    color: var(--plan-text-muted);
    margin: 0 0 6px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .plan-acceptance {
    background: rgba(255, 255, 255, 0.02);
    border-left: 2px solid var(--plan-border-strong);
    padding: 10px 14px;
    margin: 0 0 14px;
    color: var(--plan-text);
    font-size: 13.5px;
  }
  .plan-tests {
    list-style: none;
    padding: 0;
    margin: 0 0 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .plan-tests li {
    display: flex;
    gap: 10px;
    align-items: baseline;
    color: var(--plan-text);
    font-size: 13.5px;
  }
  .plan-test-mark {
    font-family: var(--font-mono);
    font-size: 11px;
    flex-shrink: 0;
  }
  .plan-test-label { flex: 1; }
  .plan-test-evidence {
    display: inline-flex;
    gap: 8px;
    font-size: 11.5px;
  }
  .plan-mile-links {
    display: flex;
    gap: 12px;
    font-size: 12px;
    color: var(--plan-text-faint);
    flex-wrap: wrap;
  }

  .plan-link {
    color: var(--plan-link);
    text-decoration: none;
    border-bottom: 1px dotted var(--plan-text-faint);
  }
  .plan-link:hover { color: var(--plan-text); }

  /* Side rail */
  .plan-rail {
    position: sticky;
    top: 32px;
    align-self: start;
    height: fit-content;
    border-left: 1px solid var(--plan-border);
    padding-left: 24px;
    font-size: 12.5px;
  }
  .plan-rail-group { margin-bottom: 28px; }
  .plan-rail-group:last-child { margin-bottom: 0; }
  .plan-rail h3 {
    font-size: 11px;
    font-weight: 500;
    color: var(--plan-text-muted);
    margin: 0 0 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .plan-rail-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 6px 0;
    color: var(--plan-text);
  }
  .plan-rail-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--plan-text-faint);
    flex-shrink: 0;
  }
  .plan-rail-row--active .plan-rail-dot {
    animation: plan-pulse 2.4s ease-in-out infinite;
  }
  .plan-rail-label { flex: 1; }

  /* Anchored sections don't slide under sticky headers */
  section[id] { scroll-margin-top: 80px; }

  /* Responsive */
  @media (max-width: 880px) {
    .plan-layout {
      grid-template-columns: 1fr;
      gap: 32px;
      padding: 32px 20px 80px;
    }
    .plan-rail {
      position: static;
      border-left: none;
      border-top: 1px solid var(--plan-border);
      padding: 24px 0 0;
    }
    .plan-milestone summary {
      grid-template-columns: auto 1fr;
    }
    .plan-mile-meta {
      grid-column: 2;
      justify-content: flex-start;
      flex-wrap: wrap;
    }
    .plan-mile-meta > span:first-child {
      max-width: 100%;
      white-space: normal;
    }
  }
</style>
