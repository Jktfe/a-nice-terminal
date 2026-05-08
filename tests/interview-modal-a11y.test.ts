import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Source-level regressions for the m6 hardening pass (interview-lite-2026-05-08).
// Vitest config doesn't transform .svelte at present, so these guards
// pin the structural markers that drive the runtime behaviour we
// verified live in Chrome (modalOpen, role=log, focus-return on close,
// dialog ARIA shape, tab focus trap).

describe('InterviewModal accessibility hardening', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/InterviewModal.svelte'),
    'utf8',
  );

  it('mounts with role=dialog + aria-modal + aria-label binding to target', () => {
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toMatch(/aria-label=\{`Interview with \$\{targetLabel\(\)\}`\}/);
  });

  it('gives the dialog overlay a tabindex so screen readers can focus it', () => {
    expect(source).toMatch(/class="iv-overlay"[\s\S]{0,500}tabindex="-1"/);
  });

  it('marks the message thread as a polite live region for SR announcements', () => {
    // Even when an agent is muted (TTS-only mute per the design), screen
    // readers must still announce the new text — role=log + aria-live
    // covers that path.
    expect(source).toMatch(/<div\s+class="iv-thread"[\s\S]{0,500}role="log"/);
    expect(source).toMatch(/aria-live="polite"/);
  });

  it('traps Tab inside the modal so keyboard users do not fall through to chat', () => {
    expect(source).toContain("if (event.key === 'Tab' && cardEl) {");
    // The trap must cycle: Shift+Tab from first → last, plain Tab from last → first.
    expect(source).toContain('if (active === first || !cardEl.contains(active))');
    expect(source).toContain('if (active === last || !cardEl.contains(active))');
  });

  it('returns focus to the original trigger when the modal closes', () => {
    // The $effect captures the previously-focused element on open and
    // refocuses it on close so keyboard users land back where they started.
    expect(source).toContain('returnFocusTo');
    expect(source).toContain('returnFocusTo?.focus()');
  });

  it('closes on Escape via the overlay key handler', () => {
    expect(source).toMatch(/if \(event\.key === 'Escape'\)/);
    expect(source).toMatch(/onClose\?\.\(\);/);
  });
});
