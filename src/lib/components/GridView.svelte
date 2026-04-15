<script lang="ts">
  import { useGridStore } from '$lib/stores/grid.svelte';
  import GridSlot from './GridSlot.svelte';

  interface Session {
    id: string;
    name: string;
    type: 'terminal' | 'chat' | 'agent' | string;
  }

  let { sessions }: { sessions: Session[] } = $props();

  const grid = useGridStore();

  let containerWidth = $state(0);
  // On very narrow screens (< 640px) force single column regardless of grid setting
  const effectiveCols = $derived(containerWidth > 0 && containerWidth < 640 ? 1 : grid.cols);
</script>

<div
  class="w-full h-full"
  bind:clientWidth={containerWidth}
  style="
    display: grid;
    grid-template-columns: repeat({effectiveCols}, minmax(0, 1fr));
    grid-template-rows: repeat({grid.rows}, minmax(0, 1fr));
    gap: 16px;
    padding: 16px;
    box-sizing: border-box;
  "
>
  {#each grid.cells as cell (cell.id)}
    <GridSlot {cell} allSessions={sessions} />
  {/each}
</div>
