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
</script>

<div
  class="w-full h-full"
  style="
    display: grid;
    grid-template-columns: repeat({grid.cols}, minmax(0, 1fr));
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
