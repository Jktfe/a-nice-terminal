<section class="completeness-strip platform-panel" aria-label="Completeness gate">
  <div>
    <p>Completeness gate</p>
    <strong>0 lost</strong>
  </div>
  <span>
    Change, dedupe, defer, or reject with a written reason. No capability disappears silently.
  </span>
</section>

<style>
  .completeness-strip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 0.9rem;
  }

  p {
    margin: 0;
    color: var(--ink-muted);
    font-size: 0.78rem;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    display: block;
    margin-top: 0.2rem;
    font-size: 1.7rem;
  }

  span {
    max-width: 50rem;
    color: var(--ink-soft);
    line-height: 1.45;
  }

  @media (max-width: 720px) {
    .completeness-strip {
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>
