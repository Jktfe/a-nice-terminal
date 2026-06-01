<!--
  Section 4 of the /antonline-dev landing page. Three-step quickstart
  (brew install → ant up → first post). Extracted from +page.svelte
  to keep the parent under the 600-line cap. CSS tokens inherit from
  the parent .ant-marketing scope.
-->
<script lang="ts">
  // No props — copy is fixed at this stage of the launch story.
</script>

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
</style>
