/**
 * TERMINALS-T2a + T2c-impl-1 persistence-boot. Boot-once via globalThis
 * flag (per banked feedback_globalthis_pattern) so dev HMR / multiple
 * imports / reload don't double-subscribe to ptyClient output. Each
 * daemon chunk is dispatched through classifierRegistry which emits
 * 0+ ClassifiedEvents (kind ∈ message/thinking/tool_call/command/
 * agent_prompt/raw). Each event becomes one terminal_run_events row.
 * Buffer + 8KB overflow handled by registry per design Q4.
 */

import { subscribeOutput, subscribeReset } from './ptyClient';
import { appendTerminalRunEvent } from './terminalRunEventsStore';
import { dispatchClassify } from './classifierRegistry';
import { broadcastTerminalEvent } from './terminalEventBroadcast';
import { dispatchInteractiveDetect } from './interactiveEvents/registry';
import { resolveAgentKind } from './interactiveEvents/agentKindResolver';
import { normalizeForClassifier } from './classifiers/stripAnsi';
import { ensureTranscriptTailWatcherBooted } from './claudeCodeTranscriptTailWatcher';
import { ensureCodexTranscriptTailWatcherBooted } from './codexTranscriptTailWatcher';
import { ensurePiTranscriptTailWatcherBooted } from './piTranscriptTailWatcher';
import { ensureGeminiTranscriptTailWatcherBooted } from './geminiTranscriptTailWatcher';
import { ensureQwenTranscriptTailWatcherBooted } from './qwenTranscriptTailWatcher';
import { ensureCopilotTranscriptTailWatcherBooted } from './copilotTranscriptTailWatcher';
import { ensureLinkedRoomGuffPurgedOnce } from './linkedRoomAgentGuffPurge';
// T2-ROUTING-ROLLBACK (2026-05-15, JWPK pivot): regex-fanout reply router
// disabled — Chat view now sources from chat_rooms_messages directly via
// the ant chat send formula from inside the agent terminal. Authoritative
// transcript path lands in TRANSCRIPT-TAIL-CLAUDE (booted below).
// import { routeTerminalEventToLinkedRoom } from './terminalReplyRouter';

const BOOT_KEY = '__antRunEventsBooted';
const INTERACTIVE_BUFFER_CAP_BYTES = 8192;
const interactiveBuffers = new Map<string, string>();

// T2c-impl-2-codex delta-4 (2026-05-14): live JWPK-dogfood feedback that
// kind=message rows still carried `\x1b[K\r` style chunks despite delta-3
// classifier-internal RESIDUAL_CONTROL guards. Belt-and-braces: enforce
// the same invariant ONE MORE TIME at the persistence boundary so any
// classifier path that bypasses normalize+strip cannot poison ANT-view.
const RESIDUAL_CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;
function classifierEventTextLooksClean(text: string): boolean {
  return !RESIDUAL_CONTROL_RE.test(text);
}

export function ensureRunEventsPersistenceBooted(): void {
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  if (g[BOOT_KEY]) return;
  g[BOOT_KEY] = true;
  // TRANSCRIPT-TAIL-CLAUDE-v2 (2026-05-15, JWPK pivot): authoritative
  // claude-code event source — JSONL transcript tail. Boots a 2s poller
  // that ingests new lines into terminal_run_events with trust=high.
  ensureTranscriptTailWatcherBooted();
  // TRANSCRIPT-TAIL-CODEX-v2 (2026-05-15, JWPK pivot): same authoritative
  // path for codex-cli — tails ~/.codex/archived_sessions/rollout-*.jsonl
  // matched to terminal cwd via session_meta.cwd.
  ensureCodexTranscriptTailWatcherBooted();
  // TRANSCRIPT-TAIL-PI-v2 (2026-05-15): pi-cli (Ollama-mediated) — tails
  // ~/.pi/agent/sessions/--<encoded-cwd>--/<TS>_<id>.jsonl.
  ensurePiTranscriptTailWatcherBooted();
  // TRANSCRIPT-TAIL-GEMINI-v2 (2026-05-15): gemini-cli — tails
  // ~/.gemini/tmp/<lowercase-basename-of-cwd>/chats/session-*.jsonl.
  ensureGeminiTranscriptTailWatcherBooted();
  // TRANSCRIPT-TAIL-QWEN-v2 (2026-05-15): qwen-cli — tails
  // ~/.qwen/projects/<encoded-cwd>/chats/<uuid>.jsonl.
  ensureQwenTranscriptTailWatcherBooted();
  // TRANSCRIPT-TAIL-COPILOT-v2 (2026-05-15): copilot-cli — tails
  // ~/.copilot/session-state/<sessionId>/events.jsonl with cwd discovery
  // via session.start.data.context.cwd in the first event.
  ensureCopilotTranscriptTailWatcherBooted();
  // V4-BLOCKER-C (2026-05-15): one-shot purge of stale kind=agent rows the
  // rolled-back T2-RETURN-ROUTING injected into linked chat rooms.
  ensureLinkedRoomGuffPurgedOnce();
  // On a .out truncation/rotation the live byte stream resumes from the new
  // file's end. Any half-line we were stitching for interactive-prompt
  // detection belonged to the old file — drop it so a stale fragment can't
  // glue onto post-reset bytes and synthesise a phantom prompt. ANT-view
  // message/thinking history is unaffected: it's sourced from the agent's
  // JSONL transcript tail, not this PTY classification path.
  subscribeReset((sessionId) => {
    interactiveBuffers.delete(sessionId);
  });
  subscribeOutput((sessionId, data) => {
    try {
      // Durable source-of-truth row: persist the exact decoded PTY chunk before
      // any ANSI/control normalization used by the cleaner ANT-view layers.
      appendTerminalRunEvent({
        terminalId: sessionId,
        kind: 'raw',
        text: data,
        trust: 'raw',
        source: 'pty_raw',
        tsMs: Date.now(),
        payload: { stream: 'pty', exact: true }
      });
      // Resolve agent_kind ONCE per chunk; both Layer B classifier dispatch
      // and Layer A interactive-event dispatch need it. Null falls through
      // to generic classifier + skips Layer A entirely.
      const resolvedAgentKind = resolveAgentKind(sessionId);
      // T2c-impl-2-codex delta-4 (2026-05-14): live PTY chunks contain ANSI
      // escapes + screen-redraw bytes + zsh % markers that prevent line-shape
      // heuristics from firing. Normalise once before BOTH layers see it.
      const cleanChunk = normalizeForClassifier(data);
      // Layer B output classifier — durable per-line kinds.
      const events = dispatchClassify({ sessionId, chunk: cleanChunk, agentKindHint: resolvedAgentKind });
      for (const event of events) {
        // T2c-impl-2-codex delta-4: persistence-boundary guard. If text
        // still carries control bytes (e.g. classifier didn't normalize
        // or a downstream path emitted raw chunk), demote kind=message/
        // thinking/tool_call/command to kind=raw + trust=raw so ANT-view
        // (filter on kind=message) never shows control-byte rubbish.
        // Already-raw events pass through unchanged.
        const cleanText = event.kind !== 'raw' && !classifierEventTextLooksClean(event.text);
        const safeEvent = cleanText
          ? { ...event, kind: 'raw' as const, trust: 'raw' as const }
          : event;
        const tsMs = Date.now();
        appendTerminalRunEvent({
          terminalId: sessionId, kind: safeEvent.kind, text: safeEvent.text, trust: safeEvent.trust, tsMs
        });
        broadcastTerminalEvent(sessionId, { ...safeEvent, ts_ms: tsMs, source: 'pty' });
        // T2-ROUTING-ROLLBACK (2026-05-15, JWPK pivot): regex-fanout reply
        // router disabled. Chat view sources from chat_rooms_messages
        // directly. Authoritative content lands via TRANSCRIPT-TAIL-CLAUDE
        // (per-CLI transcript subscriber, next slice).
      }
      // Layer A interactive-event detector — only when we know which CLI is
      // running for this terminal AND the registry has a detector for it.
      // null/unknown ⇒ skip ENTIRELY so the buffer never accumulates.
      if (resolvedAgentKind) {
        const prior = interactiveBuffers.get(sessionId) ?? '';
        const merged = prior + cleanChunk;
        const interactive = dispatchInteractiveDetect({ sessionId, buffer: merged, agentKindHint: resolvedAgentKind });
        for (const ie of interactive.events) {
          const tsMs = Date.now();
          appendTerminalRunEvent({
            terminalId: sessionId, kind: 'agent_prompt', text: ie.promptText,
            trust: 'high', tsMs, source: 'interactive',
            payload: { eventClass: ie.eventClass, choices: ie.choices ?? [] }
          });
          broadcastTerminalEvent(sessionId, {
            kind: 'agent_prompt', text: ie.promptText, trust: 'high',
            ts_ms: tsMs, source: 'interactive'
          });
        }
        // Either consumed-and-clear, or keep buffering up to the cap; over
        // the cap drop to prevent unbounded growth on chatty no-prompt CLIs.
        const next = interactive.consumedBytes > 0 ? '' : merged;
        interactiveBuffers.set(sessionId, next.length > INTERACTIVE_BUFFER_CAP_BYTES ? '' : next);
      } else {
        // No detector → never stash. Drop any buffer that might exist.
        if (interactiveBuffers.has(sessionId)) interactiveBuffers.delete(sessionId);
      }
    } catch {
      /* persistence is best-effort; swallow to avoid breaking the stream */
    }
  });
}

export function _resetInteractiveBuffersForTests(): void {
  interactiveBuffers.clear();
}
