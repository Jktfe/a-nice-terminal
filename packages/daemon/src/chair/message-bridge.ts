/**
 * Message Bridge — polls ALL conversation sessions for new human messages
 * that @mention an agent. If the addressed agent's terminal has not produced
 * new output within the grace period, injects the raw message content into
 * the terminal so the agent is guaranteed to receive it.
 *
 * No session or room configuration required — monitors every conversation.
 */

import db from "../db.js";
import { getPty, getTerminalOutputCursor } from "../pty-manager.js";

const _TLS = process.env.ANT_TLS_CERT;
if (_TLS) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const ANT_URL = `${_TLS ? "https" : "http"}://localhost:${process.env.ANT_PORT || "6458"}`;
const POLL_INTERVAL_MS = parseInt(process.env.MESSAGE_BRIDGE_POLL_MS || "3000", 10);
const GRACE_PERIOD_MS = parseInt(process.env.MESSAGE_BRIDGE_GRACE_MS || "6000", 10);

// ─── Pure helpers (exported for tests) ───────────────────────────────────────

export function extractMentions(content: string): string[] {
  const matches = content.match(/@[\w]+/g);
  return matches ?? [];
}

export function shouldInject(cursorAtSend: number, cursorNow: number): boolean {
  return cursorNow <= cursorAtSend;
}

// ─── Settings ────────────────────────────────────────────────────────────────

function getSetting(key: string, fallback: string): string {
  const row = db.prepare("SELECT value FROM server_state WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

function isEnabled(): boolean {
  return getSetting("chairman_enabled", "0") === "1";
}

// ─── Session discovery ───────────────────────────────────────────────────────

function getAllChatSessionIds(): string[] {
  const rows = db
    .prepare("SELECT id FROM sessions WHERE type IN ('conversation', 'unified') AND archived = 0")
    .all() as { id: string }[];
  return rows.map((r) => r.id);
}

// ─── Participant lookup (all agents with active terminals) ────────────────────

interface Participant {
  terminalSessionId: string;
  agentName: string;
}

function getAllParticipants(): Participant[] {
  const rows = db
    .prepare(`
      SELECT DISTINCT st.terminal_session_id as terminalSessionId, ar.handle as agentName
      FROM session_terminals st
      JOIN conversation_members cm ON cm.session_id = st.session_id
      JOIN agent_registry ar ON ar.id = cm.agent_id
      WHERE st.status = 'active' AND ar.handle IS NOT NULL
    `)
    .all() as Participant[];
  return rows;
}

// ─── State ───────────────────────────────────────────────────────────────────

// Per-session tracking of injected message IDs and cursor positions
const sessionInjectedIds = new Map<string, Set<string>>();
const sessionLastSeenAt = new Map<string, string>();
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let busy = false;

// ─── Poll ────────────────────────────────────────────────────────────────────

async function pollSession(sessionId: string, participants: Participant[]): Promise<void> {
  try {
    const lastSeen = sessionLastSeenAt.get(sessionId);
    const url = lastSeen
      ? `${ANT_URL}/api/sessions/${sessionId}/messages?since=${encodeURIComponent(lastSeen)}`
      : `${ANT_URL}/api/sessions/${sessionId}/messages`;

    const res = await fetch(url);
    if (!res.ok) return;

    const messages: Array<{ id: string; role: string; content: string; created_at: string; sender_type: string }> =
      await res.json();

    if (messages.length === 0) return;
    sessionLastSeenAt.set(sessionId, messages[messages.length - 1].created_at);

    const injectedIds = sessionInjectedIds.get(sessionId) ?? new Set<string>();
    sessionInjectedIds.set(sessionId, injectedIds);

    for (const msg of messages) {
      if (msg.role !== "human") continue;
      if (injectedIds.has(msg.id)) continue;

      const mentions = extractMentions(msg.content);
      if (mentions.length === 0) continue;

      // Mark as processed before the mention loop so an exception can't cause re-processing
      injectedIds.add(msg.id);

      for (const mention of mentions) {
        const participant = participants.find(
          (p) => p.agentName.toLowerCase() === mention.replace("@", "").toLowerCase()
            || p.agentName.toLowerCase() === mention.toLowerCase()
        );
        if (!participant) continue;

        const cursorAtSend = getTerminalOutputCursor(participant.terminalSessionId);

        // Wait grace period then check if cursor advanced
        await new Promise((r) => setTimeout(r, GRACE_PERIOD_MS));

        const cursorNow = getTerminalOutputCursor(participant.terminalSessionId);

        if (!shouldInject(cursorAtSend, cursorNow)) {
          // Agent's terminal produced output — message was likely received
          continue;
        }

        // Inject raw message content into terminal
        const pty = getPty(participant.terminalSessionId);
        if (!pty) {
          console.warn(`[message-bridge] PTY not found for ${participant.agentName} (session ${participant.terminalSessionId})`);
          continue;
        }

        try {
          pty.write(msg.content + "\n");
          console.log(
            `[message-bridge] Injected message ${msg.id} into ${participant.agentName}'s terminal`
          );
        } catch (err) {
          console.warn("[message-bridge] Inject failed:", err instanceof Error ? err.message : err);
        }
      }
    }
  } catch (err) {
    console.warn(`[message-bridge] Poll error for session ${sessionId}:`, err instanceof Error ? err.message : err);
  }
}

async function poll(): Promise<void> {
  if (busy) return;
  if (!isEnabled()) return;

  const sessionIds = getAllChatSessionIds();
  if (sessionIds.length === 0) return;

  busy = true;
  try {
    const participants = getAllParticipants();
    await Promise.all(sessionIds.map((id) => pollSession(id, participants)));
  } catch (err) {
    console.warn("[message-bridge] Poll error:", err instanceof Error ? err.message : err);
  } finally {
    busy = false;
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export function startMessageBridge(): void {
  if (intervalHandle) return;
  console.log(`[message-bridge] Starting (poll every ${POLL_INTERVAL_MS}ms, watching all sessions)`);
  intervalHandle = setInterval(poll, POLL_INTERVAL_MS);
  poll().catch(() => {});
}

export function stopMessageBridge(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    sessionInjectedIds.clear();
    sessionLastSeenAt.clear();
    console.log("[message-bridge] Stopped");
  }
}
