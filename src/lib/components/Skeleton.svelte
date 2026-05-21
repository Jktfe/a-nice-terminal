<!--
  Skeleton — animated shimmer placeholder for content that's still loading.

  Replaces bare "Loading…" text with a low-attention visual indicator
  matched to the eventual content shape. Props:
    - height: any CSS length (default 1rem)
    - width:  any CSS length (default 100%)
    - rounded: 'sm' | 'md' | 'pill' (default 'sm')
    - lines:  optional N to render N stacked bars (each with a slightly
              narrower last bar for the "paragraph" look)

  prefers-reduced-motion: reduce flattens the animation to a static
  muted block so users with vestibular sensitivity aren't ambushed.
-->
<script lang="ts">
  type Rounded = 'sm' | 'md' | 'pill';

  type Props = {
    width?: string;
    height?: string;
    rounded?: Rounded;
    lines?: number;
    label?: string;
  };

  let {
    width = '100%',
    height = '1rem',
    rounded = 'sm',
    lines = 1,
    label
  }: Props = $props();

  const radiusMap: Record<Rounded, string> = {
    sm: '0.35rem',
    md: '0.6rem',
    pill: '999px'
  };
  const radius = $derived(radiusMap[rounded]);
</script>

{#if lines > 1}
  <div class="skeleton-stack" role="status" aria-label={label ?? 'Loading'}>
    {#each Array.from({ length: lines }) as _, i (i)}
      <div
        class="skeleton"
        style:width={i === lines - 1 ? '72%' : width}
        style:height={height}
        style:border-radius={radius}
        aria-hidden="true"
      ></div>
    {/each}
  </div>
{:else}
  <div
    class="skeleton"
    role="status"
    aria-label={label ?? 'Loading'}
    style:width={width}
    style:height={height}
    style:border-radius={radius}
  ></div>
{/if}

<style>
  .skeleton-stack {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .skeleton {
    display: block;
    background:
      linear-gradient(
        90deg,
        color-mix(in srgb, var(--line-soft) 50%, transparent) 0%,
        color-mix(in srgb, var(--line-soft) 80%, transparent) 50%,
        color-mix(in srgb, var(--line-soft) 50%, transparent) 100%
      );
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.2s ease-in-out infinite;
  }
  @keyframes skeleton-shimmer {
    0% { background-position: 100% 0; }
    100% { background-position: -100% 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .skeleton {
      background: color-mix(in srgb, var(--line-soft) 60%, transparent);
      animation: none;
    }
  }
</style>
