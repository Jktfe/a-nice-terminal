<!--
  Section 5 of the /antonline-dev landing page. Three pricing tiers —
  open source / native / enterprise. Extracted from +page.svelte to
  keep the parent under the 600-line cap. CSS tokens inherit from the
  parent .ant-marketing scope. .tier-cta styling is duplicated here
  (it lived in the parent's shared CTA block) so the featured tier's
  red-pill CTA renders identically.
-->
<script lang="ts">
  // No props — copy is fixed at this stage of the launch story.
</script>

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
  /* tier-cta also lives in the parent (shared with hero CTAs) so the
     featured tier's red-pill button keeps its shape inside this scoped
     stylesheet. Duplicating these declarations keeps the visual match
     exact without leaking selectors out to the parent. */
  .tier-cta {
    display: inline-block;
    padding: 0.85rem 1.5rem;
    border-radius: 999px;
    font-weight: 800;
    font-size: 1rem;
    text-decoration: none;
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
</style>
