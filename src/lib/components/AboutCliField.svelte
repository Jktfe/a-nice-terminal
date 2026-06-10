<script lang="ts">
  import type { AboutCliPage } from '$lib/aboutCliPages';

  type Props = {
    page: AboutCliPage;
    activeIndex?: number;
  };

  let { page, activeIndex = 0 }: Props = $props();
  const points = $derived(page.loop.slice(0, 5));
</script>

<div
  class="field"
  style={`--about-bg:${page.theme.bg};--about-accent:${page.theme.accent};--about-accent-2:${page.theme.accent2}`}
  aria-label={`${page.name} workflow diagram`}
>
  <svg viewBox="0 0 920 360" role="img" aria-labelledby={`${page.slug}-field-title`}>
    <title id={`${page.slug}-field-title`}>{page.name} workflow map</title>
    <rect x="18" y="18" width="884" height="324" rx="28" class="frame" />
    <path class="flow primary" d="M120 224 C230 92 350 92 460 224 S690 352 812 110" />
    <path class="flow secondary" d="M120 128 C248 292 354 292 482 128 S700 36 812 232" />
    {#each points as point, index}
      <g class:active={index === activeIndex}>
        <circle
          class="node"
          cx={120 + index * 173}
          cy={index % 2 === 0 ? 224 : 128}
          r={index === activeIndex ? 51 : 43}
        />
        <text x={120 + index * 173} y={(index % 2 === 0 ? 224 : 128) + 6}>{point}</text>
      </g>
    {/each}
  </svg>
</div>

<style>
  .field {
    min-height: 18rem;
    border: 1px solid color-mix(in srgb, var(--about-accent) 45%, transparent);
    border-radius: 0.8rem;
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--about-accent) 18%, transparent), transparent 46%),
      var(--about-bg);
    box-shadow: 0 24px 80px rgb(0 0 0 / 22%);
    overflow: hidden;
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 18rem;
  }

  .frame {
    fill: color-mix(in srgb, var(--about-bg) 86%, white);
    stroke: color-mix(in srgb, var(--about-accent) 55%, white);
    stroke-width: 2;
  }

  .flow {
    fill: none;
    stroke-width: 5;
    stroke-linecap: round;
    opacity: 0.8;
  }

  .primary {
    stroke: var(--about-accent-2);
  }

  .secondary {
    stroke: color-mix(in srgb, var(--about-accent) 70%, white);
    opacity: 0.45;
  }

  .node {
    fill: color-mix(in srgb, var(--about-bg) 76%, var(--about-accent));
    stroke: color-mix(in srgb, var(--about-accent-2) 72%, white);
    stroke-width: 3;
    transition:
      r 160ms ease,
      fill 160ms ease,
      stroke 160ms ease;
  }

  g.active .node {
    fill: color-mix(in srgb, var(--about-accent) 45%, var(--about-bg));
    stroke: white;
  }

  text {
    fill: #fffaf0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 16px;
    font-weight: 850;
    text-anchor: middle;
    dominant-baseline: middle;
  }

  @media (max-width: 720px) {
    .field,
    svg {
      min-height: 14rem;
    }

    text {
      font-size: 13px;
    }
  }
</style>

