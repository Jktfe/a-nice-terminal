<script lang="ts">
  import AboutCliField from '$lib/components/AboutCliField.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>ABOUT-[CLI] profile pages</title>
  <meta
    name="description"
    content="Characterful, source-backed Svelte ABOUT pages for coding CLIs and local runtime lanes."
  />
</svelte:head>

<main class="about-index">
  <section class="hero-band" aria-label="Page purpose">
    <div>
      <p class="kicker">ABOUT-[CLI]</p>
      <h1>Six CLI profiles with their own weather.</h1>
    </div>
    <p>
      These are not ANT brand pages. They lift the better Task 1 “about me”
      energy into reusable Svelte pages, then tighten the claims for a generic
      open source audience with public sources and clear boundaries.
    </p>
  </section>

  <section class="grid" aria-label="ABOUT CLI pages">
    {#each data.pages as page, index}
      <article
        class={`card card-${page.slug}`}
        style={`--about-accent:${page.theme.accent};--about-accent-2:${page.theme.accent2};--about-bg:${page.theme.bg};--about-panel:${page.theme.panel}`}
      >
        <AboutCliField {page} activeIndex={index % page.loop.length} />
        <div class="card-body">
          <div class="card-top">
            <span class="badge">{page.character.handle}</span>
            <span class="file">{page.fileName}</span>
          </div>
          <h2>{page.character.title}</h2>
          <p class="opener">{page.character.opener}</p>
          <p>{page.character.voice}</p>
          <div class="chips" aria-label={`${page.name} workflow`}>
            {#each page.loop as step}
              <span>{step}</span>
            {/each}
          </div>
          <a class="open-link" href={`/about-clis/${page.slug}`}>Open {page.shortName}</a>
        </div>
      </article>
    {/each}
  </section>
</main>

<style>
  :global(body) {
    background:
      linear-gradient(180deg, #090a0f 0%, #15120f 48%, #08090d 100%);
    color: #f8f4ea;
  }

  .about-index {
    width: min(1240px, calc(100% - 32px));
    margin: 0 auto;
    padding: clamp(24px, 5vw, 56px) 0 72px;
  }

  .hero-band {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(19rem, 0.62fr);
    gap: clamp(1rem, 4vw, 3rem);
    align-items: center;
    min-height: 58svh;
    margin: 0 0 1.5rem;
    padding: clamp(1.2rem, 5vw, 4rem);
    border: 1px solid rgb(255 255 255 / 14%);
    border-radius: 1.4rem;
    background:
      linear-gradient(115deg, rgb(255 255 255 / 9%), transparent 38%),
      linear-gradient(135deg, #131722, #0a0b10 58%, #17110d);
    box-shadow: 0 28px 90px rgb(0 0 0 / 34%);
    min-width: 0;
    overflow: hidden;
  }

  .kicker {
    margin: 0 0 0.35rem;
    color: #79e2ff;
    font-size: 0.75rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    max-width: 54rem;
    color: #fff8ea;
    font-size: clamp(3rem, 7.2vw, 7.5rem);
    line-height: 0.98;
    letter-spacing: 0;
  }

  .hero-band > p {
    color: #cfd6dc;
    font-size: 1.05rem;
    line-height: 1.6;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1.1rem;
  }

  .card {
    display: flex;
    flex-direction: column;
    min-width: 0;
    max-width: 100%;
    border: 1px solid color-mix(in srgb, var(--about-accent) 42%, transparent);
    border-radius: 1.1rem;
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--about-accent) 12%, transparent), transparent 34%),
      color-mix(in srgb, var(--about-bg) 94%, white);
    overflow: hidden;
    box-shadow: 0 24px 70px rgb(0 0 0 / 28%);
  }

  .card :global(.field) {
    min-height: 12.5rem;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .card :global(.field svg) {
    min-height: 12.5rem;
  }

  .card-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.85rem;
    padding: 1.05rem;
  }

  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .badge,
  .file,
  .chips span {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.72rem;
    font-weight: 850;
  }

  .badge {
    color: var(--about-accent);
    text-transform: uppercase;
  }

  .file {
    color: rgb(255 255 255 / 54%);
  }

  h2 {
    color: #fff8ea;
    font-size: 1.8rem;
    line-height: 1.02;
    letter-spacing: 0;
    overflow-wrap: anywhere;
  }

  .opener {
    color: color-mix(in srgb, var(--about-accent-2) 82%, white);
    font-size: 1.03rem;
    font-weight: 850;
  }

  .card p {
    color: rgb(246 248 255 / 74%);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .chips span {
    padding: 0.32rem 0.48rem;
    border: 1px solid color-mix(in srgb, var(--about-accent) 38%, transparent);
    border-radius: 0.45rem;
    color: #f8f4ea;
    background: color-mix(in srgb, var(--about-accent) 18%, transparent);
  }

  .open-link {
    margin-top: auto;
    width: fit-content;
    padding: 0.55rem 0.75rem;
    border: 1px solid var(--about-accent);
    border-radius: 999px;
    color: #fff8ea;
    font-weight: 900;
    text-decoration: none;
  }

  .open-link:hover {
    background: color-mix(in srgb, var(--about-accent) 38%, transparent);
  }

  @media (max-width: 1100px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 760px) {
    .hero-band,
    .grid {
      grid-template-columns: 1fr;
    }

    h2 {
      font-size: 2.35rem;
    }
  }
</style>
