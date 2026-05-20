<script lang="ts">
  import type { PreparedQuestion } from '$lib/domain/types';

  type Props = {
    question: PreparedQuestion;
  };

  let { question }: Props = $props();
</script>

<section class="decision-card" aria-labelledby={`${question.id}-title`}>
  <div class="decision-topline">
    <span>Needs decision</span>
    <strong>{question.roomName}</strong>
  </div>

  <h2 id={`${question.id}-title`}>{question.question}</h2>
  <p>{question.whyItMatters}</p>

  <div class="options" aria-label="Decision options">
    {#each question.options as option}
      <article class:recommended={option.letter === question.recommendedOption}>
        <span class="option-letter">{option.letter}</span>
        <div>
          <h3>{option.title}</h3>
          <p>{option.tradeOff}</p>
          <small>{option.effect}</small>
        </div>
      </article>
    {/each}
  </div>

  <button type="button">Pick {question.recommendedOption}</button>
</section>

<style>
  .decision-card {
    display: grid;
    gap: 1.15rem;
    padding: 1.25rem;
    border: 1px solid var(--line-soft);
    border-radius: 1.35rem;
    background: var(--surface-card);
    box-shadow: var(--shadow-card);
  }

  .decision-topline {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    color: var(--ink-muted);
    font-size: 0.82rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .decision-topline span {
    padding: 0.4rem 0.65rem;
    border-radius: 999px;
    color: white;
    background: var(--accent);
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h2 {
    max-width: 18ch;
    font-size: clamp(2.1rem, 5vw, 4.8rem);
    line-height: 0.9;
    letter-spacing: 0;
  }

  .decision-card > p {
    max-width: 62ch;
    color: var(--ink-soft);
    font-size: 1rem;
    line-height: 1.5;
  }

  .options {
    display: grid;
    gap: 0.75rem;
  }

  article {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.8rem;
    padding: 0.9rem;
    border: 1px solid var(--line-soft);
    border-radius: 1rem;
    background: var(--surface-raised);
  }

  article.recommended {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .option-letter {
    display: grid;
    width: 2rem;
    height: 2rem;
    place-items: center;
    border-radius: 999px;
    color: white;
    background: var(--info);
    font-weight: 900;
  }

  article.recommended .option-letter {
    background: var(--accent);
  }

  h3 {
    font-size: 1rem;
  }

  article p {
    margin-top: 0.25rem;
    color: var(--ink-soft);
    line-height: 1.35;
  }

  small {
    display: block;
    margin-top: 0.45rem;
    color: var(--ink-muted);
    font-weight: 800;
  }

  button {
    width: fit-content;
    min-height: 2.9rem;
    padding: 0 1.3rem;
    border: 0;
    border-radius: 999px;
    color: white;
    background: var(--accent);
    font-weight: 900;
  }

  :global(:root[data-theme='dark']) button,
  :global(:root[data-theme='dark']) .decision-topline span,
  :global(:root[data-theme='dark']) article.recommended .option-letter {
    color: #101607;
  }
</style>

