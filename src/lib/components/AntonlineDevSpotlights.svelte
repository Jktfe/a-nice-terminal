<!--
  Section 2 of the /antonline-dev landing page. Three feature
  spotlights — invite, long-memory, modal-stack. Extracted from
  +page.svelte to keep the parent under the 600-line cap. Pure
  presentational markup + scoped styles; the parent owns the
  --marketing-* tokens which we inherit via CSS variable lookup.
-->
<script lang="ts">
  // No props — copy is fixed at this stage of the launch story.
</script>

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

<style>
  /* Inherits --marketing-* tokens from the parent .ant-marketing scope. */
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
</style>
