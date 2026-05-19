<script lang="ts">
  interface DayActivity {
    day: string;
    count: number;
    max?: number;
  }

  let { activities }: { activities: DayActivity[] } = $props();

  function getIntensity(count: number, max?: number): string {
    if (count === 0) return 'var(--hairline)';
    const effectiveMax = max || 10;
    const ratio = count / effectiveMax;
    if (ratio > 0.75) return 'var(--agent-color)';
    if (ratio > 0.5) return 'var(--agent-color)99';
    if (ratio > 0.25) return 'var(--agent-color)66';
    return 'var(--agent-color)44';
  }
</script>

<div class="activity-strip">
  {#each activities as day (day.day)}
    <div class="day-cell" title="{day.day}: {day.count} events">
      <div 
        class="activity-bar" 
        style="background: {getIntensity(day.count, day.max)}; height: {Math.min(100, (day.count / (day.max || 10)) * 100)}%;"
      ></div>
      <span class="day-label">{day.day}</span>
    </div>
  {/each}
</div>

<style>
  .activity-strip {
    display: flex;
    gap: 4px;
    height: 48px;
    align-items: flex-end;
  }

  .day-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    flex: 1;
  }

  .activity-bar {
    width: 100%;
    min-height: 4px;
    border-radius: 2px;
    transition: height 300ms ease, background 300ms ease;
  }

  .day-label {
    font-size: 9px;
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
</style>
