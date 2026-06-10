<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const page = $derived(data.page);
</script>

<svelte:head>
  <title>{page.fileName}</title>
  <meta name="description" content={page.summary} />
</svelte:head>

<main
  class="original-shell"
  style={`--about-accent:${page.theme.accent};--about-bg:${page.theme.bg}`}
>
  <nav class="bar" aria-label="ABOUT CLI navigation">
    <a href="/about-clis">ABOUT-[CLI]</a>
    <span>{page.fileName}</span>
    <a href={page.sourcePage} target="_blank" rel="noreferrer">Open full page</a>
  </nav>

  <iframe
    title={`${page.name} ABOUT page`}
    src={page.sourcePage}
    loading="eager"
  ></iframe>
</main>

<style>
  :global(body) {
    margin: 0;
    overflow: hidden;
    background: var(--about-bg, #05070a);
  }

  .original-shell {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    height: 100svh;
    background: var(--about-bg);
  }

  .bar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    gap: 1rem;
    align-items: center;
    min-height: 3rem;
    padding: 0.55rem 0.8rem;
    border-bottom: 1px solid color-mix(in srgb, var(--about-accent) 44%, transparent);
    background: rgb(0 0 0 / 74%);
    color: rgb(255 255 255 / 72%);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.78rem;
    font-weight: 850;
    text-transform: uppercase;
  }

  .bar span {
    color: #fff8ea;
    text-align: center;
    overflow-wrap: anywhere;
  }

  .bar a {
    color: color-mix(in srgb, var(--about-accent) 72%, white);
    text-decoration: none;
  }

  .bar a:last-child {
    justify-self: end;
  }

  iframe {
    width: 100%;
    height: 100%;
    min-width: 0;
    border: 0;
    background: var(--about-bg);
  }

  @media (max-width: 700px) {
    .bar {
      grid-template-columns: 1fr;
      gap: 0.35rem;
      align-items: start;
    }

    .bar span,
    .bar a:last-child {
      justify-self: start;
      text-align: left;
    }
  }
</style>
