<script lang="ts">
  let rigObject: HTMLObjectElement | null = $state(null);
  let isCrawling = $state(true);
  let rigLoaded = $state(false);

  const elementCards = [
    { label: 'Head', src: '/ant-crawler/elements/head.svg' },
    { label: 'Thorax', src: '/ant-crawler/elements/thorax.svg' },
    { label: 'Abdomen', src: '/ant-crawler/elements/abdomen.svg' },
    { label: 'Antennae', src: '/ant-crawler/elements/antennae.svg' },
    { label: 'Front leg', src: '/ant-crawler/elements/front-leg.svg' },
    { label: 'Middle leg', src: '/ant-crawler/elements/middle-leg.svg' },
    { label: 'Rear leg', src: '/ant-crawler/elements/rear-leg.svg' },
    { label: 'Contact sheet', src: '/ant-crawler/ant-crawler-elements.svg' }
  ];

  function applyCrawlState() {
    const root = rigObject?.contentDocument?.documentElement;
    if (!root) return;
    root.classList.toggle('is-crawling', isCrawling);
  }

  function handleRigLoad() {
    rigLoaded = true;
    applyCrawlState();
  }

  function setMotion(next: boolean) {
    isCrawling = next;
    applyCrawlState();
  }
</script>

<svelte:head>
  <title>ANT crawler rig demo</title>
  <meta
    name="description"
    content="Premium SVG animation rig demo for the ANT crawler asset pack."
  />
</svelte:head>

<main id="main-content" class="crawler-demo">
  <header class="demo-header">
    <div>
      <p class="eyebrow">Premium SVG motion rig</p>
      <h1>ANT crawler rig</h1>
      <p>
        Svelte-owned demo page for the polished assembled crawler and its
        individual SVG elements.
      </p>
    </div>
    <a class="asset-link" href="/ant-crawler/ant-crawler-rig.svg">Open rig SVG</a>
  </header>

  <section class="stage" aria-label="Animated ANT crawler demo">
    <div class="crawl-track"></div>
    {#if !rigLoaded}
      <div class="loading">Loading rig</div>
    {/if}
    <object
      bind:this={rigObject}
      class:loaded={rigLoaded}
      type="image/svg+xml"
      data="/ant-crawler/ant-crawler-rig.svg"
      aria-label="Animated ANT crawler rig"
      onload={handleRigLoad}
    ></object>

    <div class="controls" aria-label="Animation controls">
      <button class:active={isCrawling} type="button" onclick={() => setMotion(true)}>Crawl</button>
      <button class:active={!isCrawling} type="button" onclick={() => setMotion(false)}>Still</button>
    </div>
  </section>

  <section class="parts-grid" aria-label="Individual SVG crawler elements">
    {#each elementCards as card}
      <article class="part-card">
        <img src={card.src} alt={`${card.label} SVG element`} />
        <span>{card.label}</span>
      </article>
    {/each}
  </section>
</main>

<style>
  :global(html),
  :global(body) {
    margin: 0;
    background: #04080c;
  }

  :global(.logout-button) {
    display: none;
  }

  .crawler-demo {
    min-height: 100vh;
    width: 100%;
    margin: 0;
    padding: 34px 16px 48px;
    color: #f5fbf7;
    background:
      linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px),
      radial-gradient(circle at 52% 28%, rgba(28, 211, 114, 0.2), transparent 42%),
      #04080c;
    background-size: 34px 34px, 34px 34px, 100% 100%, 100% 100%;
    font-family:
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      sans-serif;
  }

  .demo-header {
    width: min(1180px, 100%);
    margin: 0 auto 18px;
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 18px;
  }

  .eyebrow {
    margin: 0 0 8px;
    color: #8bf3bd;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: clamp(34px, 5.5vw, 72px);
    line-height: 0.94;
    letter-spacing: 0;
  }

  p {
    max-width: 56ch;
    margin: 8px 0 0;
    color: #b9c8c0;
    line-height: 1.45;
  }

  .asset-link {
    flex: 0 0 auto;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    padding: 10px 13px;
    color: #f5fbf7;
    text-decoration: none;
    background: rgba(255, 255, 255, 0.08);
  }

  .stage {
    position: relative;
    width: min(1180px, 100%);
    min-height: 570px;
    margin: 0 auto;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 18px;
    background:
      radial-gradient(circle at 58% 44%, rgba(255, 255, 255, 0.08), transparent 46%),
      linear-gradient(145deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.03));
    box-shadow: 0 36px 96px rgba(0, 0, 0, 0.48);
  }

  .crawl-track {
    position: absolute;
    right: 7%;
    bottom: 28%;
    left: 7%;
    height: 2px;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.28), transparent);
  }

  object {
    position: absolute;
    top: 48%;
    left: 50%;
    width: min(760px, 82vw);
    aspect-ratio: 226 / 154;
    height: auto;
    opacity: 0;
    transform: translate(-50%, -50%);
    filter: drop-shadow(0 24px 34px rgba(0, 0, 0, 0.28));
  }

  object.loaded {
    opacity: 1;
  }

  .loading {
    position: absolute;
    top: 50%;
    left: 50%;
    color: #a9b8b0;
    transform: translate(-50%, -50%);
  }

  .controls {
    position: absolute;
    right: 18px;
    bottom: 18px;
    display: flex;
    gap: 8px;
  }

  button {
    appearance: none;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    padding: 10px 13px;
    color: #f5fbf7;
    background: rgba(255, 255, 255, 0.08);
    cursor: pointer;
  }

  button.active {
    border-color: rgba(28, 211, 114, 0.75);
    background: rgba(28, 211, 114, 0.16);
  }

  .parts-grid {
    width: min(1180px, 100%);
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin: 14px auto 0;
  }

  .part-card {
    min-height: 138px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 12px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.07);
  }

  .part-card img {
    display: block;
    width: 100%;
    height: 92px;
    margin-bottom: 8px;
    object-fit: contain;
  }

  .part-card span {
    color: #b9c8c0;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  @media (max-width: 760px) {
    .demo-header {
      display: block;
    }

    .asset-link {
      display: inline-block;
      margin-top: 14px;
    }

    .stage {
      min-height: 430px;
    }

    object {
      width: min(560px, 94vw);
    }

    .parts-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
