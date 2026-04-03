/**
 * Message Bridge — delivers new human messages that @mention an agent
 * directly to that agent's terminal PTY.
 *
 * No polling. Listens to the daemon event bus and fires the moment a message
 * is committed to the DB. A configurable grace period lets the agent's
 * terminal self-respond before falling back to PTY injection.
 *
 * No session or room configuration required — monitors every Chat.
 */

import db from "../db.js";
import { bus, type NewMessagePayload } from "../events/bus.js";
import { getPty, getTerminalOutputCursor } from "../pty-manager.js";

const GRACE_PERIOD_MS = parseInt(process.env.MESSAGE_BRIDGE_GRACE_MS || "6000", 10);

// ─── Pure helpers (exported for tests) ───────────────────────────────────────

export function extractMentions(content: string): string[] {
  const matches = content.match(/@[\w]+/g);
  return matches ?? [];
}

export function shouldInject(cursorAtSend: number, cursorNow: number): boolean {
  return cursorNow <= cursorAtSend;
}

// ─── Participant lookup ───────────────────────────────────────────────────────

interface Participant {
  terminalSessionId: string;
  agentName: string;
}

function getAllParticipants(): Participant[] {
  return db
    .prepare(`
      SELECT DISTINCT st.terminal_session_id as terminalSessionId, ar.handle as agentName
      FROM session_terminals st
      JOIN conversation_members cm ON cm.session_id = st.session_id
      JOIN agent_registry ar ON ar.id = cm.agent_id
      WHERE st.status = 'active' AND ar.handle IS NOT NULL
    `)
    .all() as Participant[];
}

function isEnabled(): boolean {
  const row = db
    .prepare("SELECT value FROM server_state WHERE key = ?")
    .get("chairman_enabled") as { value: string } | undefined;
  return row?.value === "1";
}

// ─── Core handler ─────────────────────────────────────────────────────────────

// Track which message IDs we've already acted on across all sessions.
const processedIds = new Set<string>();

async function handleNewMessage(payload: NewMessagePayload): Promise<void> {
  if (!isEnabled()) return;
  if (payload.role !== "human") return;
  if (processedIds.has(payload.id)) return;

  const mentions = extractMentions(payload.content);
  if (mentions.length === 0) return;

  // Mark early so concurrent events for the same message don't double-inject.
  processedIds.add(payload.id);

  // Cap the set to avoid unbounded growth over long daemon lifetimes.
  if (processedIds.size > 10_000) {
    const oldest = processedIds.values().next().value;
    if (oldest !== undefined) processedIds.delete(oldest);
  }

  const participants = getAllParticipants();

  for (const mention of mentions) {
    const participant = participants.find(
      (p) =>
        p.agentName.toLowerCase() === mention.replace("@", "").toLowerCase() ||
        p.agentName.toLowerCase() === mention.toLowerCase()
    );
    if (!participant) continue;

    const cursorAtSend = getTerminalOutputCursor(participant.terminalSessionId);

    // Grace period: give the agent time to self-respond before we inject.
    await new Promise<void>((resolve) => setTimeout(resolve, GRACE_PERIOD_MS));

    const cursorNow = getTerminalOutputCursor(participant.terminalSessionId);
    if (!shouldInject(cursorAtSend, cursorNow)) continue; // agent already responded

    const pty = getPty(participant.terminalSessionId);
    if (!pty) {
      console.warn(
        `[message-bridge] PTY not found for ${participant.agentName} (session ${participant.terminalSessionId})`
      );
      continue;
    }

    try {
      pty.write(payload.content + "\n");
      console.log(
        `[message-bridge] Injected message ${payload.id} into ${participant.agentName}'s terminal`
      );
    } catch (err) {
      console.warn(
        "[message-bridge] Inject failed:",
        err instanceof Error ? err.message : err
      );
    }
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let started = false;

export function startMessageBridge(): void {
  if (started) return;
  started = true;
  bus.on("message:new", (payload) => {
    handleNewMessage(payload).catch((err) => {
      console.warn("[message-bridge] Handler error:", err instanceof Error ? err.message : err);
    });
  });
  console.log("[message-bridge] Started (event-driven, no polling)");
}

export function stopMessageBridge(): void {
  if (!started) return;
  bus.off("message:new", handleNewMessage as (payload: NewMessagePayload) => void);
  processedIds.clear();
  started = false;
  console.log("[message-bridge] Stopped");
}
