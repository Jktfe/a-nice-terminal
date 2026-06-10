<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import AboutCliField from '$lib/components/AboutCliField.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>ABOUT-[CLI] pages | ANT vNext</title>
  <meta
    name="description"
    content="Source-backed Svelte ABOUT pages for coding CLIs and local runtime lanes."
  />
</svelte:head>

<SimplePageShell
  eyebrow="OSS agent pages"
  title="ABOUT-[CLI] pages."
  summary="Public, source-backed Svelte pages for the CLI layer. Model pages stay out of scope until the model landscape settles."
>
  <section class="hero-band" aria-label="Page purpose">
    <div>
      <p class="kicker">Capability first</p>
      <h2>These pages explain the tool surface, not the personality.</h2>
    </div>
    <p>
      Each page keeps the image-led Task 1 feel, but the copy is written for a
      generic open source audience: what the CLI does, where it fits, where it
      should not be overclaimed, and which public sources back the claims.
    </p>
  </section>

  <section class="grid" aria-label="ABOUT CLI pages">
    {#each data.pages as page, index}
      <article class="card" style={`--about-accent:${page.theme.accent};--about-panel:${page.theme.panel}`}>
        <AboutCliField {page} activeIndex={index % page.loop.length} />
        <div class="card-body">
          <div class="card-top">
            <span class="badge">{page.badge}</span>
            <span class="file">{page.fileName}</span>
          </div>
          <h3>{page.name}</h3>
          <p>{page.summary}</p>
          <div class="chips" aria-label={`${page.name} workflow`}>
            {#each page.loop as step}
              <span>{step}</span>
            {/each}
          </div>
          <a class="open-link" href={`/about-clis/${page.slug}`}>Open Svelte page</a>
        </div>
      </article>
    {/each}
  </section>
</SimplePageShell>

<style>
  .hero-band {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(20rem, 0.8fr);
    gap: 1.2rem;
    align-items: end;
    margin: 0 0 1.2rem;
    padding: 1.2rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.8rem;
    background: var(--surface-card);
    box-shadow: var(--shadow-card);
  }

  .kicker {
    margin: 0 0 0.35rem;
    color: var(--accent);
    font-size: 0.75rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h2 {
    max-width: 48rem;
    color: var(--ink-strong);
    font-size: clamp(2rem, 4vw, 4.2rem);
    line-height: 0.98;
  }

  .hero-band > p {
    color: var(--ink-soft);
    line-height: 1.6;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1rem;
  }

  .card {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: 1px solid color-mix(in srgb, var(--about-accent) 32%, var(--line-soft));
    border-radius: 0.8rem;
    background: var(--surface-card);
    overflow: hidden;
    box-shadow: var(--shadow-card);
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
    padding: 1rem;
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
    color: var(--ink-muted);
  }

  h3 {
    color: var(--ink-strong);
    font-size: 1.55rem;
    letter-spacing: 0;
  }

  .card p {
    color: var(--ink-soft);
    line-height: 1.5;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .chips span {
    padding: 0.32rem 0.48rem;
    border: 1px solid color-mix(in srgb, var(--about-accent) 28%, var(--line-soft));
    border-radius: 0.45rem;
    color: var(--ink-soft);
    background: color-mix(in srgb, var(--about-accent) 8%, var(--surface-card));
  }

  .open-link {
    margin-top: auto;
    width: fit-content;
    padding: 0.55rem 0.75rem;
    border: 1px solid var(--about-accent);
    border-radius: 0.55rem;
    color: var(--about-accent);
    font-weight: 900;
    text-decoration: none;
  }

  .open-link:hover {
    background: color-mix(in srgb, var(--about-accent) 10%, var(--surface-card));
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

