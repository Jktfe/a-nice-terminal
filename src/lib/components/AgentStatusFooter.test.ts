import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/components/AgentStatusFooter.svelte', 'utf8');

describe('AgentStatusFooter source contract', () => {
  it('keeps each crawling ant identifiable without hover', () => {
    expect(source).toContain('<aside class="agent-status-footer"');
    expect(source).toContain('class="agent-nameplate"');
    expect(source).toContain('<strong>{entry.handle}</strong>');
    expect(source).toContain('<span>{STATUS_LABEL[entry.status]}</span>');
  });

  it('keeps idle ants visible instead of freezing them off-canvas', () => {
    expect(source).toContain('--rest-left:${restLeft}%');
    expect(source).toContain('left: var(--rest-left);');
    expect(source).toContain('animation: none;');
  });

  it('pauses the moving ant while its tooltip is being used', () => {
    expect(source).toContain('.agent-ant:hover,');
    expect(source).toContain('.agent-ant:focus-visible');
    expect(source).toContain('animation-play-state: paused;');
  });
});
