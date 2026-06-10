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
  class={`field field-${page.slug}`}
  style={`--about-bg:${page.theme.bg};--about-accent:${page.theme.accent};--about-accent-2:${page.theme.accent2}`}
  aria-label={`${page.name} visual profile`}
>
  <svg viewBox="0 0 920 360" role="img" aria-labelledby={`${page.slug}-field-title`}>
    <title id={`${page.slug}-field-title`}>{page.name} profile instrument</title>
    <rect x="18" y="18" width="884" height="324" rx="28" class="frame" />
    <path class="grid-line" d="M62 82 H858 M62 162 H858 M62 242 H858" />
    <path class="grid-line vertical" d="M190 50 V310 M362 50 V310 M534 50 V310 M706 50 V310" />
    <path class="flow primary" d="M104 244 C226 72 338 76 456 222 S682 342 820 98" />
    <path class="flow secondary" d="M104 116 C244 304 354 296 484 126 S704 44 820 238" />
    <g class="identity-mark">
      <rect x="54" y="50" width="202" height="50" rx="14" />
      <text x="74" y="81" class="handle">{page.character.handle}</text>
    </g>
    <g class="artifact">
      <rect x="596" y="260" width="264" height="48" rx="14" />
      <text x="728" y="289">{page.character.artifact}</text>
    </g>
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
    <text x="460" y="188" class="title">{page.shortName}</text>
  </svg>
</div>

<style>
  .field {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    min-height: 18rem;
    border: 1px solid color-mix(in srgb, var(--about-accent) 45%, transparent);
    border-radius: 0.8rem;
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--about-accent) 20%, transparent), transparent 42%),
      linear-gradient(225deg, color-mix(in srgb, var(--about-accent-2) 16%, transparent), transparent 48%),
      var(--about-bg);
    box-shadow: 0 24px 80px rgb(0 0 0 / 22%);
    overflow: hidden;
  }

  svg {
    display: block;
    width: 100%;
    max-width: 100%;
    height: 100%;
    min-height: 18rem;
  }

  .frame {
    fill: color-mix(in srgb, var(--about-bg) 90%, white);
    stroke: color-mix(in srgb, var(--about-accent) 55%, white);
    stroke-width: 2;
  }

  .grid-line {
    fill: none;
    stroke: color-mix(in srgb, white 18%, transparent);
    stroke-width: 1;
  }

  .vertical {
    opacity: 0.5;
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
    fill: color-mix(in srgb, var(--about-bg) 72%, var(--about-accent));
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
    overflow-wrap: anywhere;
  }

  .title {
    fill: color-mix(in srgb, white 86%, var(--about-accent-2));
    font-size: 54px;
    font-weight: 950;
    opacity: 0.18;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .identity-mark rect,
  .artifact rect {
    fill: color-mix(in srgb, var(--about-bg) 70%, black);
    stroke: color-mix(in srgb, var(--about-accent) 55%, white);
  }

  .identity-mark text,
  .artifact text {
    fill: color-mix(in srgb, white 88%, var(--about-accent-2));
    font-size: 14px;
    font-weight: 800;
  }

  .artifact text {
    font-size: 12px;
  }

  .field-claude-code {
    --about-bg: #120f13;
  }

  .field-codex-cli .frame {
    rx: 6;
  }

  .field-antigravity .primary,
  .field-antigravity .secondary {
    stroke-dasharray: 18 12;
  }

  .field-github-copilot-cli {
    background:
      linear-gradient(135deg, rgb(73 244 255 / 16%), transparent 42%),
      linear-gradient(225deg, rgb(255 79 216 / 14%), transparent 52%),
      var(--about-bg);
  }

  .field-qwen-code .node {
    stroke-dasharray: 7 5;
  }

  .field-pi-local .flow {
    stroke-width: 3;
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
