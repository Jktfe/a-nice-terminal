/**
 * Message Bridge — polls the chairman chat session for new human messages
 * that @mention an agent. If the addressed agent's terminal has not produced
 * new output within the grace period, injects the raw message content into
 * the terminal so the agent is guaranteed to receive it.
 */

import db from "./db.js";
import { getPty, getTerminalOutputCursor } from "./pty-manager.js";

const ANT_URL = `http://localhost:${process.env.ANT_PORT || "6458"}`;
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

function getSessionId(): string | null {
  return getSetting("chairman_session", "") || null;
}

function getRoomName(): string | null {
  return getSetting("chairman_room", "") || null;
}

// ─── Participant lookup ──────────────────────────────────────────────────────

interface Participant {
  terminalSessionId: string;
  agentName: string;
}

async function getRoomParticipants(roomName: string): Promise<Participant[]> {
  try {
    const res = await fetch(
      `${ANT_URL}/api/chat-rooms/${encodeURIComponent(roomName)}/participants`
    );
    if (!res.ok) return [];
    return (await res.json()) as Participant[];
  } catch {
    return [];
  }
}

// ─── State ───────────────────────────────────────────────────────────────────

const injectedMessageIds = new Set<string>();
let lastSeenAt: string | null = null;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let busy = false;

// ─── Poll ────────────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  if (busy) return;
  if (!isEnabled()) return;

  const sessionId = getSessionId();
  const roomName = getRoomName();
  if (!sessionId || !roomName) return;

  busy = true;
  try {
    const url = lastSeenAt
      ? `${ANT_URL}/api/sessions/${sessionId}/messages?since=${encodeURIComponent(lastSeenAt)}`
      : `${ANT_URL}/api/sessions/${sessionId}/messages`;

    const res = await fetch(url);
    if (!res.ok) return;

    const messages: Array<{ id: string; role: string; content: string; created_at: string; sender_type: string }> =
      await res.json();

    if (messages.length === 0) return;
    lastSeenAt = messages[messages.length - 1].created_at;

    const participants = await getRoomParticipants(roomName);

    for (const msg of messages) {
      if (msg.role !== "human") continue;
      if (injectedMessageIds.has(msg.id)) continue;

      const mentions = extractMentions(msg.content);
      if (mentions.length === 0) continue;

      // Mark as processed before the mention loop so an exception can't cause re-processing
      injectedMessageIds.add(msg.id);

      for (const mention of mentions) {
        const participant = participants.find(
          (p) => p.agentName.toLowerCase() === mention.toLowerCase()
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
    console.warn("[message-bridge] Poll error:", err instanceof Error ? err.message : err);
  } finally {
    busy = false;
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export function startMessageBridge(): void {
  if (intervalHandle) return;
  console.log(`[message-bridge] Starting (poll every ${POLL_INTERVAL_MS}ms)`);
  intervalHandle = setInterval(poll, POLL_INTERVAL_MS);
  poll().catch(() => {});
}

export function stopMessageBridge(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    injectedMessageIds.clear();
    lastSeenAt = null;
    console.log("[message-bridge] Stopped");
  }
}
