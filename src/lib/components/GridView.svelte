<script lang="ts">
  import { useGridStore } from '$lib/stores/grid.svelte';
  import GridCell from './GridCell.svelte';

  interface Session {
    id: string;
    name: string;
    type: string;
  }

  let { sessions }: { sessions: Session[] } = $props();

  const grid = useGridStore();
</script>

<div
  class="w-full h-full p-1.5"
  style="
    display: grid;
    grid-template-columns: repeat({grid.cols}, minmax(0, 1fr));
    grid-template-rows: repeat({grid.rows}, minmax(0, 1fr));
    gap: 6px;
  "
>
  {#each grid.cells as cell (cell.id)}
    <GridCell {cell} {sessions} />
  {/each}
</div>
