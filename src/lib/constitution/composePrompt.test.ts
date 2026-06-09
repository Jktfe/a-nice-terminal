import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  composeSystemPrompt,
  assertTurnStable,
  TurnStabilityError
} from './composePrompt';
import { ROLE_OVERLAYS, roleOverlay } from './roles';

const CONSTITUTION = '# ANT Constitution (v0)\n\nAct, dont ask. Verify before you claim.';
const ROLE = ROLE_OVERLAYS.verifier;

describe('composeSystemPrompt — cache-friendly system blocks', () => {
  it('puts the constitution prefix in block 0 with cache_control: ephemeral', () => {
    const blocks = composeSystemPrompt({ constitution: CONSTITUTION });
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[0].text).toContain('ANT Constitution');
  });

  it('appends the role overlay into the SAME cached prefix block', () => {
    const blocks = composeSystemPrompt({ constitution: CONSTITUTION, roleOverlay: ROLE });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toContain('Role overlay: Verifier');
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  // THE GATE (per @researchant): differing volatile inputs must NEVER change the
  // cached prefix, or the prompt cache is busted every turn.
  it('prefix is BYTE-IDENTICAL across differing volatile context (cache hit holds)', () => {
    const a = composeSystemPrompt({
      constitution: CONSTITUTION,
      roleOverlay: ROLE,
      volatileContext: 'Today is Monday. room=alpha. turn=3. now=12:01.'
    });
    const b = composeSystemPrompt({
      constitution: CONSTITUTION,
      roleOverlay: ROLE,
      volatileContext: 'Today is Tuesday. room=omega. turn=9001. now=23:59.'
    });
    expect(a[0].text).toBe(b[0].text); // identical prefix
    expect(a[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('volatile context is a SEPARATE trailing block with NO cache_control', () => {
    const blocks = composeSystemPrompt({ constitution: CONSTITUTION, volatileContext: 'room=alpha' });
    expect(blocks).toHaveLength(2);
    expect(blocks[1].cache_control).toBeUndefined();
    expect(blocks[1].text).toContain('room=alpha');
  });

  it('no volatile context → a single cached block', () => {
    expect(composeSystemPrompt({ constitution: CONSTITUTION })).toHaveLength(1);
  });

  it('rejects an empty constitution', () => {
    expect(() => composeSystemPrompt({ constitution: '   ' })).toThrow(/empty/);
  });

  it('roleOverlay() resolves a known role and undefined otherwise', () => {
    expect(roleOverlay('builder')).toBe(ROLE_OVERLAYS.builder);
    expect(roleOverlay(undefined)).toBeUndefined();
  });
});

describe('assertTurnStable — keeps volatile content OUT of the cached prefix', () => {
  // The adversarial cases: a leak of any of these into the prefix must throw,
  // so a regression fails loudly instead of silently busting the cache.
  it('throws on an ISO timestamp leak', () => {
    expect(() => assertTurnStable('built at 2026-06-09T10:00')).toThrow(TurnStabilityError);
  });
  it('throws on a bare ISO date leak', () => {
    expect(() => assertTurnStable('today is 2026-06-09')).toThrow(TurnStabilityError);
  });
  it('throws on a turn-counter leak', () => {
    expect(() => assertTurnStable('you are on turn=42')).toThrow(TurnStabilityError);
    expect(() => assertTurnStable('handling turn 42 now')).toThrow(TurnStabilityError);
    expect(() => assertTurnStable('see message #7')).toThrow(TurnStabilityError);
  });
  it('throws on a clock-time leak', () => {
    expect(() => assertTurnStable('the time is 23:59')).toThrow(TurnStabilityError);
  });
  it('throws on a uuid / session-id leak', () => {
    expect(() => assertTurnStable('session d6885d06-b810-4a85-9287-ee118512755c')).toThrow(
      TurnStabilityError
    );
  });
  it('passes ordinary turn-stable prose', () => {
    expect(() => assertTurnStable('Act, dont ask. Verify before you claim. One name per concept.')).not.toThrow();
  });

  // composeSystemPrompt enforces the guard end-to-end: a leaked timestamp or
  // turn-counter in the constitution/overlay aborts the compose.
  it('composeSystemPrompt throws when a timestamp leaks into the prefix', () => {
    expect(() => composeSystemPrompt({ constitution: 'rules v0, built 2026-06-09T10:00' })).toThrow(
      TurnStabilityError
    );
  });
  it('composeSystemPrompt throws when a turn-counter leaks into the prefix', () => {
    expect(() =>
      composeSystemPrompt({ constitution: CONSTITUTION, roleOverlay: 'context: turn=3' })
    ).toThrow(TurnStabilityError);
  });
});

describe('the real constitution.md is cache-safe', () => {
  it('is turn-stable and composes to an ephemeral-cached prefix', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const text = readFileSync(join(root, 'constitution.md'), 'utf8');
    // composeSystemPrompt runs assertTurnStable internally — no throw ⇒ the
    // shipped constitution carries no volatile content.
    const blocks = composeSystemPrompt({ constitution: text });
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks).toHaveLength(1);
  });

  it('every role overlay is itself turn-stable', () => {
    for (const overlay of Object.values(ROLE_OVERLAYS)) {
      expect(() => assertTurnStable(overlay)).not.toThrow();
    }
  });
});
