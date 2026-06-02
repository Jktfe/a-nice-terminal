import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const actionsSource = readFileSync(
  fileURLToPath(new URL('./MessageRowActions.svelte', import.meta.url)),
  'utf8'
);
const reactionsSource = readFileSync(
  fileURLToPath(new URL('./MessageReactionsBar.svelte', import.meta.url)),
  'utf8'
);

function cssBlock(source: string, selector: string): string {
  const match = source.match(new RegExp(`${selector.replace('.', '\\.')}\\s*{[^}]*}`));
  if (!match) throw new Error(`Missing CSS block for ${selector}`);
  return match[0];
}

describe('MessageRowActions layout contract', () => {
  it('keeps copy in its own slot to the left of reactions', () => {
    const copySlotIndex = actionsSource.indexOf('class="copy-action-slot"');
    const reactionSlotIndex = actionsSource.indexOf('class="reaction-action-slot"');

    expect(copySlotIndex).toBeGreaterThan(-1);
    expect(reactionSlotIndex).toBeGreaterThan(-1);
    expect(copySlotIndex).toBeLessThan(reactionSlotIndex);
    expect(actionsSource).toMatch(/\.copy-action-slot[\s\S]*margin-right:/);
  });

  it('lets the parent action strip position the reaction trigger', () => {
    const reactionHostCss = cssBlock(reactionsSource, '.reaction-host');

    expect(reactionHostCss).toMatch(/position:\s*relative/);
    expect(reactionHostCss).not.toMatch(/position:\s*absolute/);
  });
});
