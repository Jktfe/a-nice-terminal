<section class="cockpit-header" aria-label="Dashboard summary">
  <div>
    <p class="eyebrow">Platform dashboard</p>
    <h1>Today across rooms</h1>
  </div>
  <div class="header-actions" aria-label="Primary actions">
    <button type="button">Start room</button>
    <button type="button">Invite agent</button>
    <button type="button">Open terminal</button>
  </div>
</section>

<style>
  .cockpit-header {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.1rem 0;
  }

  .eyebrow {
    margin: 0;
    color: var(--ink-muted);
    font-size: 0.78rem;
    font-weight: 900;
    text-transform: uppercase;
  }

  h1 {
    margin: 0.15rem 0 0;
    font-size: clamp(2.4rem, 5.8vw, 5.8rem);
    line-height: 0.9;
    letter-spacing: 0;
  }

  .header-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  button {
    min-height: 2.45rem;
    padding: 0 0.85rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    color: var(--ink-strong);
    background: var(--surface-card);
    font-weight: 850;
  }

  button:first-child {
    border-color: var(--accent);
    color: white;
    background: var(--accent);
  }

  :global(:root[data-theme='dark']) button:first-child {
    color: #101607;
  }

  @media (max-width: 720px) {
    .cockpit-header {
      align-items: stretch;
      flex-direction: column;
    }

    .header-actions button {
      flex: 1 1 12rem;
    }
  }
</style>
