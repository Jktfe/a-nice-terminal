/**
 * Shared PTY-input helpers — the SINGLE path both the Raw view
 * (Terminal.svelte) and the ANT view (TerminalAntView.svelte) use to
 * push operator input into a terminal. Lifted verbatim from the Raw
 * view's original inline handlers (FINDING-1 ANT-input-parity) so the
 * two views can never drift: same endpoint, same loopback guard, same
 * two-call paste timing.
 *
 * Endpoint: POST /api/terminals/[id]/input  { data }  → 202 (fire-and-forget)
 */
import { isTerminalResponseLoopback } from '$lib/terminal/ansiResponseFilter';

/** Single POST of one chunk. Loopback-guarded (never echo a terminal's
 *  own ANSI response back into it). Fire-and-forget per backend contract. */
export async function postInput(terminalId: string, data: string): Promise<void> {
  if (isTerminalResponseLoopback(data)) return;
  await fetch(`/api/terminals/${encodeURIComponent(terminalId)}/input`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data })
  }).catch((cause) => {
    console.error('[ptyInput] input POST failed', cause);
  });
}

/** Free-text submit: send the text, then send CR 5ms later so the shell
 *  receives the command intact (avoids bracketed-paste swallowing the
 *  trailing Enter). Skips the trailing CR if the text already ends one. */
export async function sendText(terminalId: string, text: string): Promise<void> {
  await postInput(terminalId, text);
  if (!text.endsWith('\n') && !text.endsWith('\r')) {
    setTimeout(() => { void postInput(terminalId, '\r'); }, 5);
  }
}

/** Special-key / paste dispatch. Multi-char non-control sequences are
 *  treated as a clipboard paste (text then optional CR); single keys and
 *  control sequences (ESC, Ctrl-C, Tab, CR) go through as-is. Verbatim
 *  Raw-view two-call paste protocol. */
export async function handleSpecialKey(terminalId: string, seq: string): Promise<void> {
  if (seq.length > 1 && !seq.startsWith('\x1b') && seq.charCodeAt(0) !== 3 && seq !== '\t' && seq !== '\r') {
    await postInput(terminalId, seq);
    if (!seq.endsWith('\n') && !seq.endsWith('\r')) {
      setTimeout(() => { void postInput(terminalId, '\r'); }, 5);
    }
    return;
  }
  await postInput(terminalId, seq);
}
