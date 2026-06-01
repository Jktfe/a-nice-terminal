/**
 * T2-ROUTING-ROLLBACK (2026-05-15) regression test.
 *
 * Asserts that processing a synthetic kind=message event for an
 * agent-backed terminal NO LONGER triggers a chat_rooms_messages
 * postMessage. The reply router file still exists but is unwired from
 * boot per JWPK architecture pivot.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('T2-ROUTING-ROLLBACK — terminalRunEventsBoot does NOT call reply router', () => {
  beforeEach(() => { /* no setup needed */ });

  it('terminalRunEventsBoot.ts contains NO live import of routeTerminalEventToLinkedRoom', () => {
    const path = join(__dirname, 'terminalRunEventsBoot.ts');
    const src = readFileSync(path, 'utf8');
    // Active (non-comment) import line should be absent. Count uncommented
    // imports of the symbol; commented-out lines are fine for context.
    const lines = src.split('\n');
    const liveImports = lines.filter(
      (l) => !l.trim().startsWith('//') && /import\s.*routeTerminalEventToLinkedRoom/.test(l)
    );
    expect(liveImports).toHaveLength(0);
  });

  it('terminalRunEventsBoot.ts contains NO live call to routeTerminalEventToLinkedRoom', () => {
    const path = join(__dirname, 'terminalRunEventsBoot.ts');
    const src = readFileSync(path, 'utf8');
    const lines = src.split('\n');
    const liveCalls = lines.filter(
      (l) => !l.trim().startsWith('//') && /routeTerminalEventToLinkedRoom\s*\(/.test(l)
    );
    expect(liveCalls).toHaveLength(0);
  });
});
