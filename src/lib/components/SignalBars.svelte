<script lang="ts">
  let {
    level = 4,
    color = '#34D06F',
    muted = 'rgba(255,255,255,0.08)',
  }: {
    level?: number;
    color?: string;
    muted?: string;
  } = $props();

  const bars = [0, 1, 2, 3];
</script>

<div class="flex items-end gap-0.5" style="height: 12px;">
  {#each bars as i}
    <div
      style="
        width: 2.5px;
        height: {3 + i * 2.5}px;
        border-radius: 1px;
        background: {i < level ? color : muted};
        transition: background var(--duration-base) var(--spring-default);
      "
    ></div>
  {/each}
</div>
