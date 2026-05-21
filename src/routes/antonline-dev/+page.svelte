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
-->
<script lang="ts">
  // Pure marketing page — no live data, no operator session needed. Lays
  // out the launch story so JWPK can react to the SHAPE before recording
  // any of the video assets.
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
  <section class="spotlights" aria-label="What's inside">
    <header class="section-head">
      <h2>Three things you can do today.</h2>
      <p>Real features running in the room you'd self-host. No mockups.</p>
    </header>
    <div class="spotlight-grid">
      <article class="spotlight">
        <div class="spotlight-clip" aria-hidden="true">
          <span class="clip-play">▶</span>
          <span class="clip-sub">90s clip · remote invite flow</span>
        </div>
        <h3>Invite anyone, in 30 seconds.</h3>
        <p>
          Mint an invite with a label and password. Share the link. Your
          collaborator joins through their browser — no install, no account.
        </p>
        <ul class="spotlight-bullets">
          <li>Bound to one room</li>
          <li>Password rate-limit + auto-revoke</li>
          <li>Three kinds: browser, CLI, MCP</li>
        </ul>
      </article>

      <article class="spotlight">
        <div class="spotlight-clip" aria-hidden="true">
          <span class="clip-play">▶</span>
          <span class="clip-sub">90s clip · long-memory toggle</span>
        </div>
        <h3>Memory that survives every reset.</h3>
        <p>
          Long-memory off: search since the last break. Long-memory on: the
          whole room's history is yours. Agents inherit it; humans curate it.
        </p>
        <ul class="spotlight-bullets">
          <li>Per-room toggle</li>
          <li>Break-aware boundaries</li>
          <li>Vault mines old rooms into reusable memories</li>
        </ul>
      </article>

      <article class="spotlight">
        <div class="spotlight-clip" aria-hidden="true">
          <span class="clip-play">▶</span>
          <span class="clip-sub">90s clip · destructive-action discipline</span>
        </div>
        <h3>Destructive actions, deliberately.</h3>
        <p>
          Kill a terminal? Choose archive (keep the transcript for mining) or
          delete (gone). Three-button modals everywhere risk is real, sitting
          cleanly above every dropdown.
        </p>
        <ul class="spotlight-bullets">
          <li>Kill + Archive or Kill + Delete</li>
          <li>Modal stacking that never hides behind dropdowns</li>
          <li>Every destructive path needs a deliberate click</li>
        </ul>
      </article>
    </div>
  </section>

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
    <div class="architecture-frame" aria-label="Architecture diagram placeholder">
      <div class="arch-placeholder">
        <span class="arch-label">flowspec architecture diagram</span>
        <span class="arch-sub">renders here on launch — sourced from the flowspec canvas</span>
      </div>
    </div>
  </section>

  <!-- ============================== SECTION 4: QUICKSTART ============================== -->
  <section id="quickstart" class="quickstart" aria-labelledby="quickstart-head">
    <header class="section-head">
      <h2 id="quickstart-head">Quickstart.</h2>
      <p>Three commands, four minutes, your own room running.</p>
    </header>
    <ol class="quickstart-steps">
      <li>
        <h3>1 · Install</h3>
        <pre><code>brew install jktfe/ant/ant</code></pre>
        <p>Adds the <code>ant</code> CLI and the local service.</p>
      </li>
      <li>
        <h3>2 · Boot</h3>
        <pre><code>ant up</code></pre>
        <p>Starts the server on <code>localhost:6174</code> and seeds your first room.</p>
      </li>
      <li>
        <h3>3 · Talk</h3>
        <pre><code>ant rooms post my-first-room "hello team"</code></pre>
        <p>You're in. Open <code>http://localhost:6174/rooms</code> to see the room.</p>
      </li>
    </ol>
  </section>

  <!-- ============================== SECTION 5: PRICING ============================== -->
  <section class="pricing" aria-labelledby="pricing-head">
    <header class="section-head">
      <h2 id="pricing-head">Pricing.</h2>
      <p>Open source forever. Pay for the native apps and the heavier tiers.</p>
    </header>
    <div class="pricing-grid">
      <article class="tier">
        <h3>Open source</h3>
        <p class="tier-price">Free</p>
        <p class="tier-strap">Self-host with full functionality.</p>
        <ul>
          <li>Unlimited rooms, agents, terminals</li>
          <li>Vault, memory, plans, tasks</li>
          <li>Browser + CLI + MCP join surfaces</li>
          <li>Community support via GitHub</li>
        </ul>
        <a class="tier-cta" href="https://github.com/Jktfe/antDev">Get the repo</a>
      </article>

      <article class="tier tier-featured">
        <h3>Native</h3>
        <p class="tier-price">£5.99 / month</p>
        <p class="tier-strap">Native macOS, iOS, and Android chat apps.</p>
        <ul>
          <li>Everything in Open source</li>
          <li>Native macOS Swift app · iOS · Android Tauri</li>
          <li>Push notifications, share extension, system integration</li>
          <li>Direct email support</li>
        </ul>
        <span class="tier-cta tier-cta-disabled">Wait-list opens at launch</span>
      </article>

      <article class="tier">
        <h3>Enterprise</h3>
        <p class="tier-price">Contact us</p>
        <p class="tier-strap">Multi-org, SSO, audit, plug-in policy.</p>
        <ul>
          <li>Everything in Native</li>
          <li>SSO + identity federation</li>
          <li>Plug-in approval policy + audit trail</li>
          <li>SLA + on-call support</li>
        </ul>
        <a class="tier-cta" href="mailto:james@newmodel.vc">Email us</a>
      </article>
    </div>
  </section>

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
     dev preview matches what the public landing will look like. */
  :global(html), :global(body) { margin: 0; }
  .ant-marketing {
    --marketing-bg: #fdfbf6;
    --marketing-ink: #1b1810;
    --marketing-soft: #6b6759;
    --marketing-accent: #c63b3b;
    --marketing-edge: rgba(27, 24, 16, 0.12);

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
  .cta-ghost,
  .tier-cta {
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
    aspect-ratio: 16 / 9;
    border-radius: 1.2rem;
    background: linear-gradient(180deg, #f3eee0 0%, #ece6d4 100%);
    border: 1px solid var(--marketing-edge);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .hero-video-content {
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

  /* ============================== SPOTLIGHTS ============================== */
  .spotlights {
    padding: 4rem 1.5rem;
    background: white;
    border-top: 1px solid var(--marketing-edge);
    border-bottom: 1px solid var(--marketing-edge);
  }
  .spotlight-grid {
    max-width: 76rem;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
    gap: 1.5rem;
  }
  .spotlight {
    padding: 1.5rem;
    border-radius: 1rem;
    background: var(--marketing-bg);
    border: 1px solid var(--marketing-edge);
  }
  .spotlight-clip {
    aspect-ratio: 16 / 9;
    border-radius: 0.7rem;
    background: linear-gradient(135deg, #f0eadc 0%, #e2dac4 100%);
    margin-bottom: 1.2rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
  }
  .clip-play {
    width: 2.4rem;
    height: 2.4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--marketing-accent);
    color: white;
    font-size: 0.9rem;
  }
  .clip-sub {
    font-size: 0.78rem;
    color: var(--marketing-soft);
    font-weight: 600;
  }
  .spotlight h3 {
    margin: 0 0 0.5rem;
    font-size: 1.35rem;
    font-weight: 900;
    line-height: 1.15;
  }
  .spotlight p {
    margin: 0 0 0.85rem;
    color: var(--marketing-soft);
    font-size: 0.98rem;
    line-height: 1.5;
  }
  .spotlight-bullets {
    margin: 0;
    padding-left: 1.1rem;
    color: var(--marketing-ink);
    font-size: 0.9rem;
    line-height: 1.55;
  }
  .spotlight-bullets li {
    margin-bottom: 0.25rem;
  }

  /* ============================== ARCHITECTURE ============================== */
  .architecture {
    padding: 5rem 1.5rem;
  }
  .architecture-frame {
    max-width: 64rem;
    margin: 0 auto;
  }
  .arch-placeholder {
    aspect-ratio: 16 / 9;
    border-radius: 1rem;
    border: 2px dashed var(--marketing-edge);
    background: white;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--marketing-soft);
    gap: 0.4rem;
  }
  .arch-label {
    font-weight: 700;
    color: var(--marketing-ink);
    font-size: 1.05rem;
  }
  .arch-sub {
    font-size: 0.85rem;
  }

  /* ============================== QUICKSTART ============================== */
  .quickstart {
    padding: 5rem 1.5rem;
    background: white;
    border-top: 1px solid var(--marketing-edge);
    border-bottom: 1px solid var(--marketing-edge);
  }
  .quickstart-steps {
    max-width: 56rem;
    margin: 0 auto;
    padding: 0;
    list-style: none;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    gap: 1.5rem;
  }
  .quickstart-steps li {
    padding: 1.5rem;
    border-radius: 0.95rem;
    background: var(--marketing-bg);
    border: 1px solid var(--marketing-edge);
  }
  .quickstart-steps h3 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
    color: var(--marketing-accent);
    font-weight: 800;
  }
  .quickstart-steps pre {
    margin: 0 0 0.85rem;
    padding: 0.75rem;
    background: #1b1810;
    color: #f5f0e1;
    border-radius: 0.5rem;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.85rem;
    overflow-x: auto;
  }
  .quickstart-steps p {
    margin: 0;
    font-size: 0.9rem;
    color: var(--marketing-soft);
  }
  .quickstart-steps code {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.85rem;
    padding: 0.05rem 0.3rem;
    background: var(--marketing-bg);
    color: var(--marketing-ink);
    border-radius: 0.3rem;
  }
  .quickstart-steps pre code {
    background: transparent;
    padding: 0;
    color: inherit;
  }

  /* ============================== PRICING ============================== */
  .pricing {
    padding: 5rem 1.5rem 4rem;
  }
  .pricing-grid {
    max-width: 64rem;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
    gap: 1.25rem;
  }
  .tier {
    padding: 2rem 1.5rem;
    border-radius: 1.1rem;
    background: white;
    border: 1px solid var(--marketing-edge);
    display: flex;
    flex-direction: column;
  }
  .tier-featured {
    border-color: var(--marketing-accent);
    box-shadow: 0 18px 50px rgba(198, 59, 59, 0.12);
    transform: translateY(-6px);
  }
  .tier h3 {
    margin: 0 0 0.5rem;
    font-size: 1.35rem;
    font-weight: 900;
  }
  .tier-price {
    margin: 0 0 0.4rem;
    font-size: 1.75rem;
    font-weight: 900;
    color: var(--marketing-ink);
  }
  .tier-strap {
    margin: 0 0 1rem;
    color: var(--marketing-soft);
    font-size: 0.95rem;
  }
  .tier ul {
    margin: 0 0 1.5rem;
    padding-left: 1.1rem;
    color: var(--marketing-ink);
    font-size: 0.92rem;
    line-height: 1.5;
    flex: 1;
  }
  .tier ul li {
    margin-bottom: 0.35rem;
  }
  .tier-cta {
    text-align: center;
    background: transparent;
    color: var(--marketing-ink);
    border: 1px solid var(--marketing-edge);
  }
  .tier-featured .tier-cta {
    background: var(--marketing-accent);
    color: white;
    border-color: transparent;
  }
  .tier-cta:hover { filter: brightness(1.05); }

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
