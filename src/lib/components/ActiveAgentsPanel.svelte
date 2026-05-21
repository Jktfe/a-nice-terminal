<script lang="ts">
  import type { AgentCard } from '$lib/domain/types';

  type Props = {
    activeAgents: AgentCard[];
  };

  let { activeAgents }: Props = $props();
</script>

<section class="agent-table platform-panel" aria-label="Active agents">
  <div class="platform-panel-heading">
    <p>Active agents</p>
    <strong>{activeAgents.length}</strong>
  </div>
  <div class="agent-list">
    {#each activeAgents as agent}
      <article>
        <span class={`agent-state ${agent.attentionState}`} aria-hidden="true"></span>
        <div>
          <h2>{agent.name}</h2>
          <p>{agent.role}</p>
        </div>
        <small>{agent.agentModel.modelName}</small>
        <small>{agent.agentModel.costTier}</small>
        <strong>{agent.tokenCountForThisSession.toLocaleString()} tokens</strong>
      </article>
    {/each}
  </div>
</section>

<style>
  .agent-table {
    margin-top: 0.9rem;
  }

  .agent-list {
    display: grid;
    gap: 0.65rem;
  }

  article {
    display: grid;
    grid-template-columns: auto minmax(160px, 1fr) minmax(120px, 0.7fr) 90px auto;
    gap: 0.75rem;
    align-items: center;
    padding: 0.75rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    background: var(--surface-card);
  }

  .agent-state {
    width: 0.85rem;
    height: 0.85rem;
    border-radius: 999px;
    background: var(--ink-muted);
  }

  .agent-state.ready {
    background: var(--ok);
  }

  .agent-state.working,
  .agent-state.thinking {
    background: var(--accent);
  }

  .agent-state.asking,
  .agent-state.waiting {
    background: var(--info);
  }

  .agent-state.stale,
  .agent-state.failed {
    background: var(--warn);
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 1rem;
  }

  p,
  small {
    color: var(--ink-soft);
  }

  article > strong {
    justify-self: end;
  }

  @media (max-width: 720px) {
    article {
      grid-template-columns: auto 1fr;
    }

    small,
    article > strong {
      grid-column: 2;
      justify-self: start;
    }
  }
</style>
