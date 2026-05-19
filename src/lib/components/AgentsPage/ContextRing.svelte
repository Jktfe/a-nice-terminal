<script lang="ts">
  interface Props {
    percentage: number;
    size?: number;
    strokeWidth?: number;
    color?: string;
  }

  let { percentage, size = 40, strokeWidth = 3, color }: Props = $props();

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  function getColor(pct: number): string {
    if (color) return color;
    if (pct < 70) return 'var(--emerald-500)';
    if (pct < 90) return 'var(--amber-400)';
    return 'var(--danger)';
  }
</script>

<svg 
  width={size} 
  height={size} 
  viewBox={`0 0 ${size} ${size}`}
  class="context-ring"
>
  <!-- Background track -->
  <circle
    cx={size / 2}
    cy={size / 2}
    r={radius}
    fill="none"
    stroke="rgba(255,255,255,0.06)"
    stroke-width={strokeWidth}
  />
  <!-- Progress ring -->
  <circle
    cx={size / 2}
    cy={size / 2}
    r={radius}
    fill="none"
    stroke={getColor(percentage)}
    stroke-width={strokeWidth}
    stroke-linecap="round"
    stroke-dasharray={circumference}
    stroke-dashoffset={offset}
    transform={`rotate(-90 ${size / 2} ${size / 2})`}
    class="progress"
  />
</svg>

<style>
  .context-ring {
    transition: transform 300ms ease;
  }
  .progress {
    transition: stroke-dashoffset 500ms ease-in-out, stroke 300ms ease;
  }
</style>
