<!--
  /plan-mode/[planId] — Plan Mode visible board.
  Source: planModeStore (pm-store baseline) via projectPlanEvents.
  Render: PlanRoster (this slice) inside SimplePageShell baseline.
  Per Plan Mode Contract §3: SSR-first; ?include_archived=true to keep
  archived events visible.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import PlanRoster from '$lib/components/PlanRoster.svelte';
  import type { PlanEvent } from '$lib/server/planModeStore';

  type SnapshotShape = { planId: string; events: PlanEvent[]; includeArchived: boolean };

  type Props = {
    data: { snapshot: SnapshotShape };
  };

  let { data }: Props = $props();

  const snapshot = $derived(data.snapshot);
</script>

<svelte:head>
  <title>Plan · {snapshot.planId} | ANT vNext</title>
</svelte:head>

<SimplePageShell
  eyebrow="Plan Mode"
  title={snapshot.planId}
  summary="Live board for this plan. Sections, milestones, decisions, acceptance criteria, and tests projected from append-only plan events."
>
  <PlanRoster
    planId={snapshot.planId}
    events={snapshot.events}
    includeArchived={snapshot.includeArchived}
  />
</SimplePageShell>
