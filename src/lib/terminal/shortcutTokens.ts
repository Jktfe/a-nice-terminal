/**
 * shortcutTokens — per-terminal template tokens for QuickShortcutsBar chips.
 *
 * JWPK (2026-06-10, terminal): "I want a shortcut — like I have for launching
 * CLIs — that types '/rename [terminalHandle]' so the [terminalHandle] is
 * auto generated and I can quickly click through" the open terminals making
 * every CLI session easy to resume.
 *
 * Shortcut chips are GLOBAL (one list across all terminals, JWPK 2026-05-15
 * lock), so a chip can't carry a per-terminal value itself. Instead the chip
 * text carries a TOKEN and TerminalCard substitutes it at click time with
 * that terminal's value:
 *
 *   [terminalHandle] → the server-derived handle (GET /api/terminals/:id
 *                      `derivedHandle` — same deriveHandle the title-sync
 *                      injection uses, so a clicked /rename and the automatic
 *                      first-call rename agree byte-for-byte)
 *   [terminalName]   → the terminal's display name
 *
 * Unknown bracket-tokens are left verbatim (they may be real text the user
 * wants typed). A token whose value is missing is also left verbatim rather
 * than substituting an empty string — typing `/rename ` with no argument
 * into a CLI is worse than typing the literal token, which at least shows
 * the operator what went wrong.
 */

export type ShortcutTokenValues = {
  terminalHandle?: string | null;
  terminalName?: string | null;
};

// [ANThandle] is the ruled name (2026-06-12: terminalHandle → ANThandle);
// [terminalHandle] stays as a legacy alias so saved shortcuts keep working.
const TOKEN_RE = /\[(ANThandle|terminalHandle|terminalName)\]/g;

export function substituteShortcutTokens(text: string, values: ShortcutTokenValues): string {
  return text.replace(TOKEN_RE, (whole, token: string) => {
    const value = token === 'terminalName' ? values.terminalName : values.terminalHandle;
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : whole;
  });
}
