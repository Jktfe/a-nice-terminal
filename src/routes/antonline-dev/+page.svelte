<!--
  /antonline-dev — preview of the public antonline.dev landing page.

  JWPK msg_4qaxi73j6bwmpcaoyrm + ratified ask_4qaxi73j6bwmpcaoyrm:
  "Build a dev site, don't push it till I sign it off or give further
  direction." This route is the in-repo preview so JWPK can browse the
  shape before any public push. The final public site can later lift
  these components into a separate antonline.dev deploy or stay served
  from this surface behind a custom domain.

  Five sections per the ratified spec:
    1. Hero — 60s clip placeholder + headline + sub
    2. Three feature spotlights — invite / long-memory / modal-stack
    3. Architecture diagram (placeholder — wires to flowspec render later)
    4. Quickstart (brew install + first-room walkthrough)
    5. Pricing tier table (OSS / native / enterprise)

  Copy reads at the JWPK accessible-English-proof bar (msg_71divtsj8r). Marketing tone
  but no jargon. The bench can swap copy as the launch narrative tightens.

  Sections 2/4/5 live in AntonlineDev{Spotlights,Quickstart,Pricing}.svelte
  to keep this file under the 600-line component cap. Hero, Architecture,
  and Footer stay inline because their styles overlap with the shared
  --marketing-* token block already declared here.
-->
<script lang="ts">
  // Pure marketing page — no live data, no operator session needed. Lays
  // out the launch story so JWPK can react to the SHAPE before recording
  // any of the video assets.
  import AntonlineDevSpotlights from '$lib/components/AntonlineDevSpotlights.svelte';
  import AntonlineDevQuickstart from '$lib/components/AntonlineDevQuickstart.svelte';
  import AntonlineDevPricing from '$lib/components/AntonlineDevPricing.svelte';
  import AntPathAnimation from '$lib/components/AntPathAnimation.svelte';

  const heroVideoCrawlPath =
    'M 110 86 L 890 86 Q 940 86 940 136 L 940 484 Q 940 534 890 534 L 110 534 Q 60 534 60 484 L 60 136 Q 60 86 110 86';
</script>

<svelte:head>
  <title>ANT — agents that actually persist</title>
  <meta
    name="description"
    content="ANT is a shared room where people and AI agents work together. Open source, self-hosted, with memory that survives every reset."
  />
</svelte:head>

<div class="ant-marketing">
  <!-- ============================== SECTION 1: HERO ============================== -->
  <section class="hero" aria-labelledby="hero-headline">
    <div class="hero-inner">
      <p class="kicker">Open source · self-hosted · MIT-friendly tier</p>
      <h1 id="hero-headline">
        A room where <span class="accent">people and AI agents</span> work together.
      </h1>
      <p class="hero-sub">
        ANT is the coordination layer for human–agent teams. Every chat, every
        decision, every artefact stays connected — and the agents remember.
      </p>
      <div class="hero-ctas">
        <a class="cta-primary" href="https://github.com/Jktfe/antDev">Star on GitHub</a>
        <a class="cta-ghost" href="#quickstart">Quickstart</a>
      </div>
      <div class="hero-video" aria-label="60-second product clip placeholder">
        <div class="hero-video-frame">
          <div class="hero-video-crawl" aria-hidden="true">
            <AntPathAnimation
              pathStyle="custom"
              customPath={heroVideoCrawlPath}
              endMode="reset"
              antCount={8}
              spacing={12}
              duration={18500}
              bodyColor="#0a253c"
              outlineColor="#fdfbf6"
              routeColor="#c63b3b"
              antScale={0.2}
              leaderEnabled={false}
              showPath={false}
            />
          </div>
          <div class="hero-video-content">
            <span class="hero-video-play" aria-hidden="true">▶</span>
            <p>60-second hero clip lands here</p>
            <p class="hero-video-sub">
              JWPK records the take — coordinator at 14 days uptime, opens vault,
              mines an archive, watches a new agent reference it.
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ============================== SECTION 2: FEATURE SPOTLIGHTS ============================== -->
  <AntonlineDevSpotlights />

  <!-- ============================== SECTION 3: ARCHITECTURE ============================== -->
  <section class="architecture" aria-labelledby="architecture-head">
    <header class="section-head">
      <h2 id="architecture-head">How it fits together.</h2>
      <p>
        One server, one SQLite database, one shared room. Each agent is its own
        terminal; each terminal is its own conversation. ANT is the coordination
        layer between them.
      </p>
    </header>
    <div class="architecture-frame" aria-label="ANT path animation playground">
      <AntPathAnimation showControls={true} />
    </div>
  </section>

  <!-- ============================== SECTION 4: QUICKSTART ============================== -->
  <AntonlineDevQuickstart />

  <!-- ============================== SECTION 5: PRICING ============================== -->
  <AntonlineDevPricing />

  <!-- ============================== FOOTER ============================== -->
  <footer class="site-footer">
    <p>
      ANT is built by <a href="https://newmodel.vc">New Model VC</a>. Self-host
      with MIT-friendly terms. Native apps and Enterprise paid. The room is open.
    </p>
    <p class="footer-meta">
      Dev preview · not pushed to antonline.dev until JWPK signs off.
    </p>
  </footer>
</div>

<style>
  /* Pure marketing-page styling — independent of SimplePageShell so the
     dev preview matches what the public landing will look like. The
     --marketing-* tokens declared on .ant-marketing here cascade into
     the AntonlineDev* sub-components so their scoped styles can reuse
     the same palette without re-declaring it. */
  :global(html), :global(body) { margin: 0; }
  .ant-marketing {
    --marketing-bg: #fdfbf6;
    --marketing-ink: #1b1810;
    --marketing-soft: #6b6759;
    --marketing-accent: #c63b3b;
    --marketing-edge: rgba(27, 24, 16, 0.12);

    position: relative;
    overflow: hidden;
    color: var(--marketing-ink);
    background: var(--marketing-bg);
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    font-weight: 500;
    min-height: 100vh;
  }

  .section-head {
    max-width: 56rem;
    margin: 0 auto 2.5rem;
    text-align: center;
  }
  .section-head h2 {
    margin: 0 0 0.4rem;
    font-size: 2.4rem;
    font-weight: 900;
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
  .section-head p {
    margin: 0;
    color: var(--marketing-soft);
    font-size: 1.15rem;
    line-height: 1.5;
  }

  /* ============================== HERO ============================== */
  .hero {
    padding: 5rem 1.5rem 4rem;
  }
  .hero-inner {
    max-width: 64rem;
    margin: 0 auto;
    text-align: center;
  }
  .kicker {
    margin: 0 0 1.2rem;
    color: var(--marketing-soft);
    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .hero h1 {
    margin: 0 0 1.2rem;
    font-size: clamp(2.5rem, 5vw, 4.2rem);
    font-weight: 900;
    letter-spacing: -0.03em;
    line-height: 1.05;
  }
  .hero h1 .accent {
    color: var(--marketing-accent);
  }
  .hero-sub {
    margin: 0 auto 2rem;
    max-width: 42rem;
    color: var(--marketing-soft);
    font-size: 1.3rem;
    line-height: 1.45;
  }
  .hero-ctas {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
    margin-bottom: 3rem;
    flex-wrap: wrap;
  }
  .cta-primary,
  .cta-ghost {
    display: inline-block;
    padding: 0.85rem 1.5rem;
    border-radius: 999px;
    font-weight: 800;
    font-size: 1rem;
    text-decoration: none;
  }
  .cta-primary {
    background: var(--marketing-accent);
    color: white;
  }
  .cta-ghost {
    background: transparent;
    color: var(--marketing-ink);
    border: 1px solid var(--marketing-edge);
  }
  .cta-primary:hover { filter: brightness(1.05); }
  .cta-ghost:hover { border-color: var(--marketing-accent); color: var(--marketing-accent); }

  .hero-video {
    max-width: 56rem;
    margin: 0 auto;
  }
  .hero-video-frame {
    position: relative;
    aspect-ratio: 16 / 9;
    border-radius: 1.2rem;
    background: linear-gradient(180deg, #f3eee0 0%, #ece6d4 100%);
    border: 1px solid var(--marketing-edge);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .hero-video-crawl {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    opacity: 0.58;
  }
  :global(.hero-video-crawl .ant-animation-container) {
    height: 100%;
  }
  :global(.hero-video-crawl .stage) {
    min-height: 100%;
    height: 100%;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    overflow: hidden;
  }
  :global(.hero-video-crawl .stage svg) {
    min-height: 100%;
    height: 100%;
    background: transparent;
  }
  :global(.hero-video-crawl .stage svg > path) {
    opacity: 0;
  }
  @media (max-width: 700px) {
    .hero-video-crawl {
      display: none;
    }
  }
  .hero-video-content {
    position: relative;
    z-index: 1;
    text-align: center;
    color: var(--marketing-soft);
    padding: 2rem;
  }
  .hero-video-play {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 4rem;
    height: 4rem;
    border-radius: 50%;
    background: var(--marketing-accent);
    color: white;
    font-size: 1.5rem;
    margin-bottom: 1rem;
  }
  .hero-video-content p {
    margin: 0;
    font-weight: 700;
    color: var(--marketing-ink);
  }
  .hero-video-sub {
    margin-top: 0.4rem !important;
    font-weight: 500 !important;
    font-size: 0.9rem;
    color: var(--marketing-soft) !important;
    max-width: 30rem;
    margin-left: auto !important;
    margin-right: auto !important;
  }

  /* ============================== ARCHITECTURE ============================== */
  .architecture {
    padding: 5rem 1.5rem;
  }
  .architecture-frame {
    max-width: 64rem;
    margin: 0 auto;
  }


  /* ============================== FOOTER ============================== */
  .site-footer {
    padding: 3rem 1.5rem;
    text-align: center;
    color: var(--marketing-soft);
    border-top: 1px solid var(--marketing-edge);
  }
  .site-footer p {
    margin: 0;
    line-height: 1.6;
  }
  .site-footer a {
    color: var(--marketing-accent);
    font-weight: 700;
    text-decoration: none;
  }
  .footer-meta {
    margin-top: 0.5rem !important;
    font-size: 0.78rem;
    opacity: 0.7;
  }
</style>
