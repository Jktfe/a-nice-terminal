<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import AboutCliField from '$lib/components/AboutCliField.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let activeCapability = $state(0);

  const page = $derived(data.page);
  const active = $derived(page.capabilities[activeCapability] ?? page.capabilities[0]);
  const otherPages = $derived(data.pages.filter((candidate) => candidate.slug !== page.slug));
</script>

<svelte:head>
  <title>{page.fileName} | ANT vNext</title>
  <meta name="description" content={page.summary} />
</svelte:head>

<SimplePageShell
  eyebrow={page.fileName}
  title={page.name}
  summary={page.summary}
>
  <section
    class="showcase"
    style={`--about-accent:${page.theme.accent};--about-accent-2:${page.theme.accent2};--about-panel:${page.theme.panel}`}
  >
    <div class="visual">
      <AboutCliField {page} activeIndex={activeCapability} />
    </div>

    <aside class="control-panel" aria-label={`${page.name} capability controls`}>
      <span class="badge">{page.badge}</span>
      <h2>Capability surface</h2>
      <div class="capability-buttons" role="list">
        {#each page.capabilities as capability, index}
          <button
            type="button"
            class:active={activeCapability === index}
            aria-pressed={activeCapability === index}
            onclick={() => (activeCapability = index)}
          >
            <span>{index + 1}</span>
            {capability.name}
          </button>
        {/each}
      </div>
      <div class="capability-card">
        <h3>{active.name}</h3>
        <p>{active.detail}</p>
      </div>
    </aside>
  </section>

  <section class="content-grid">
    <article class="panel">
      <p class="label">Good fit</p>
      <h2>Use it when the job has rails.</h2>
      <ul>
        {#each page.goodFit as item}
          <li>{item}</li>
        {/each}
      </ul>
    </article>

    <article class="panel">
      <p class="label">Honesty line</p>
      <h2>Do not overclaim the surface.</h2>
      <ul>
        {#each page.boundaries as item}
          <li>{item}</li>
        {/each}
      </ul>
    </article>
  </section>

  <section class="signal-band" aria-label={`${page.name} signals`}>
    <div>
      <p class="label">Signals</p>
      <h2>What the page should make visible.</h2>
    </div>
    <div class="signal-list">
      {#each page.signals as signal}
        <span>{signal}</span>
      {/each}
    </div>
  </section>

  <section class="source-panel">
    <div>
      <p class="label">Sources</p>
      <h2>Public facts first.</h2>
      <p>
        These links are the first fact-check lane. They intentionally avoid
        model-version claims that will move faster than the OSS page should.
      </p>
    </div>
    <ul>
      {#each page.sources as source}
        <li><a href={source.href} target="_blank" rel="noreferrer">{source.label}</a></li>
      {/each}
    </ul>
  </section>

  <nav class="next-grid" aria-label="Other ABOUT CLI pages">
    {#each otherPages as other}
      <a href={`/about-clis/${other.slug}`} style={`--about-accent:${other.theme.accent}`}>
        <span>{other.fileName}</span>
        <strong>{other.name}</strong>
      </a>
    {/each}
  </nav>
</SimplePageShell>

<style>
  .showcase {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(20rem, 0.65fr);
    gap: 1rem;
    align-items: stretch;
    margin-bottom: 1rem;
  }

  .visual {
    min-width: 0;
  }

  .control-panel,
  .panel,
  .signal-band,
  .source-panel,
  .next-grid a {
    border: 1px solid color-mix(in srgb, var(--about-accent) 28%, var(--line-soft));
    border-radius: 0.8rem;
    background: var(--surface-card);
    box-shadow: var(--shadow-card);
  }

  .control-panel {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 1rem;
  }

  .badge,
  .label,
  .signal-list span,
  .next-grid span {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.74rem;
    font-weight: 900;
    text-transform: uppercase;
  }

  .badge,
  .label {
    color: var(--about-accent);
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h2 {
    color: var(--ink-strong);
    font-size: 1.55rem;
    line-height: 1.05;
    letter-spacing: 0;
  }

  h3 {
    color: var(--ink-strong);
    font-size: 1.15rem;
  }

  p,
  li {
    color: var(--ink-soft);
    line-height: 1.58;
  }

  .capability-buttons {
    display: grid;
    gap: 0.5rem;
  }

  .capability-buttons button {
    display: grid;
    grid-template-columns: 1.8rem minmax(0, 1fr);
    gap: 0.6rem;
    align-items: center;
    width: 100%;
    padding: 0.65rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.55rem;
    background: var(--surface-raised);
    color: var(--ink-strong);
    font-weight: 850;
    text-align: left;
  }

  .capability-buttons button span {
    display: grid;
    place-items: center;
    width: 1.8rem;
    height: 1.8rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--about-accent) 12%, var(--surface-card));
    color: var(--about-accent);
    font-size: 0.8rem;
  }

  .capability-buttons button.active {
    border-color: var(--about-accent);
    background: color-mix(in srgb, var(--about-accent) 12%, var(--surface-card));
  }

  .capability-card {
    margin-top: auto;
    padding: 0.85rem;
    border: 1px solid color-mix(in srgb, var(--about-accent) 24%, var(--line-soft));
    border-radius: 0.65rem;
    background: color-mix(in srgb, var(--about-accent) 7%, var(--surface-card));
  }

  .capability-card p {
    margin-top: 0.35rem;
  }

  .content-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  .panel {
    padding: 1.1rem;
  }

  .panel h2 {
    margin-top: 0.3rem;
  }

  ul {
    margin: 0.85rem 0 0;
    padding-left: 1.15rem;
  }

  li + li {
    margin-top: 0.45rem;
  }

  .signal-band,
  .source-panel {
    display: grid;
    grid-template-columns: minmax(0, 0.72fr) minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
    margin-top: 1rem;
    padding: 1.1rem;
  }

  .signal-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
  }

  .signal-list span {
    padding: 0.45rem 0.6rem;
    border: 1px solid color-mix(in srgb, var(--about-accent) 35%, var(--line-soft));
    border-radius: 0.5rem;
    color: var(--about-accent);
    background: color-mix(in srgb, var(--about-accent) 8%, var(--surface-card));
  }

  .source-panel p {
    margin-top: 0.45rem;
  }

  .source-panel a {
    color: var(--about-accent);
    font-weight: 850;
  }

  .next-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .next-grid a {
    display: grid;
    gap: 0.3rem;
    min-width: 0;
    padding: 0.8rem;
    color: var(--ink-strong);
    text-decoration: none;
  }

  .next-grid a:hover {
    border-color: var(--about-accent);
  }

  .next-grid span {
    color: var(--about-accent);
    overflow-wrap: anywhere;
  }

  .next-grid strong {
    font-size: 1rem;
  }

  @media (max-width: 980px) {
    .showcase,
    .content-grid,
    .signal-band,
    .source-panel {
      grid-template-columns: 1fr;
    }

    .next-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 620px) {
    .next-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
