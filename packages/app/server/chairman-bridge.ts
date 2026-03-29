/**
 * Embedded Chairman Bridge — runs inside the ANT server process.
 *
 * Uses the DB-backed antchat_tasks / antchat_participants tables as the
 * source of truth for task routing.  Polls for pending tasks and routes
 * them via LM Studio (OpenAI-compatible API).
 *
 * Still posts summary messages to the conversation session so humans can
 * follow along, but all state is persisted in the DB.
 *
 * Auto-starts when chairman_enabled is "1" in server_state.
 * Checks the toggle on every poll cycle so it can be switched on/off
 * from the UI without restarting the server.
 */

import db from "./db.js";
import { DbChatRoomRegistry, type RoomTask, type ParticipantInfo } from "./db-chat-room-registry.js";
import { startTerminalMonitor, stopTerminalMonitor } from "./terminal-monitor.js";
import { startMessageBridge, stopMessageBridge } from "./message-bridge.js";
import { startTaskWatchdog, stopTaskWatchdog } from "./task-watchdog.js";

const ANT_URL = `http://localhost:${process.env.ANT_PORT || "6458"}`;
const LM_STUDIO_URL = process.env.LM_STUDIO_URL || "http://localhost:1234";
const POLL_INTERVAL_MS = parseInt(process.env.CHAIRMAN_POLL_MS || "4000", 10);
const CHAIRMAN_NAME = process.env.CHAIRMAN_NAME || "@Chatlead";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AssignmentItem {
  task_id: string;
  assigned_to: string;
  assigned_type: string;
  branch?: string;
}

interface ChairmanDecision {
  action: "assign" | "hold" | "clarify";
  reason: string;
  assignments: AssignmentItem[];
  hold_message?: string;
  question?: string;
}

// ─── DB Registry ────────────────────────────────────────────────────────────

const registry = new DbChatRoomRegistry(db);

// ─── System prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are @Chatlead, the Chairman and task router in the MMD-and-ANT multi-agent chat.

You will be given a list of AVAILABLE PARTICIPANTS (from the room's DB) and
one or more PENDING TASKS that need to be assigned.

ROUTING RULES:
1. Match domain: ANT tasks -> ANT-domain agents; MMD tasks -> MMD-domain agents
2. If a domain is ambiguous, ask one clarifying question before routing
3. Prefer available (non-busy) agents
4. Never pick more than 2 agents for a single request unless clearly separate tasks

RESPOND ONLY WITH JSON (no prose before or after):
{
  "action": "assign" | "hold" | "clarify",
  "reason": "<one sentence>",
  "assignments": [
    { "task_id": "<the DB task id>", "assigned_to": "<agent handle>", "assigned_type": "<agent type>", "branch": "" }
  ],
  "hold_message": "<only present when action is hold>",
  "question": "<only present when action is clarify>"
}

If action is "hold" or "clarify", set assignments to [].`;

// ─── State ───────────────────────────────────────────────────────────────────

let busy = false;
let currentModel = process.env.CHAIRMAN_MODEL || "openai/gpt-oss-20b";
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let hasAnnounced = false;

// ─── Settings helpers ────────────────────────────────────────────────────────

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

function getModel(): string {
  const model = getSetting("chairman_model", currentModel);
  if (model !== currentModel) {
    console.log(`[chairman] Model updated to: ${model}`);
    currentModel = model;
  }
  return currentModel;
}

function getConfiguredRoomName(): string {
  return getSetting("chairman_room", "");
}

// ─── ANT API (for posting summary messages) ────────────────────────────────

async function postMessage(sessionId: string, content: string, metadata?: any): Promise<void> {
  const body: any = {
    role: "agent",
    content,
    format: "markdown",
    status: "complete",
    sender_name: CHAIRMAN_NAME,
    sender_type: "agent",
  };
  if (metadata) body.metadata = metadata;

  const res = await fetch(`${ANT_URL}/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error(`[chairman] Failed to post: ${res.status}`);
}

// ─── DB queries ─────────────────────────────────────────────────────────────

/** Get pending or assigned tasks for a given room (by room name). */
function getPendingTasks(roomName: string): RoomTask[] {
  const room = registry.getRoom(roomName);
  if (!room) return [];
  return room.tasks.filter(
    (t) => t.status === "pending" || t.status === "assigned"
  );
}

/** Get all participants in a room. Returns map of terminalSessionId -> ParticipantInfo. */
function getRoomParticipants(roomName: string): Map<string, ParticipantInfo> {
  const room = registry.getRoom(roomName);
  if (!room) return new Map();
  return room.participants;
}

/** Find a room that is linked to the given conversation session. */
function findRoomForSession(sessionId: string): string | undefined {
  const rooms = registry.listRooms();
  const match = rooms.find((r) => r.conversationSessionId === sessionId);
  return match?.name;
}

// ─── Build context for LM Studio ───────────────────────────────────────────

function buildContext(
  pendingTasks: RoomTask[],
  participants: Map<string, ParticipantInfo>
): string {
  const participantLines = Array.from(participants.entries())
    .map(([sessionId, info]) => {
      const model = info.model ? ` (model: ${info.model})` : "";
      return `- ${info.agentName}${model} [session: ${sessionId}]`;
    })
    .join("\n");

  const taskLines = pendingTasks
    .map((t) => {
      const assigned = t.assignedTo ? ` (currently assigned to: ${t.assignedTo})` : "";
      return `- [${t.id}] "${t.name}" — status: ${t.status}${assigned}`;
    })
    .join("\n");

  return (
    `=== Room Participants ===\n${participantLines || "(none)"}\n\n` +
    `=== Pending Tasks ===\n${taskLines || "(none)"}`
  );
}

// ─── LM Studio API ──────────────────────────────────────────────────────────

async function queryLmStudio(context: string): Promise<string> {
  const model = getModel();
  const res = await fetch(`${LM_STUDIO_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: context },
      ],
      temperature: 0.3,
      max_tokens: 500,
    }),
  });
  if (!res.ok) throw new Error(`LM Studio ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? "";
}

// ─── Response parser ─────────────────────────────────────────────────────────

function parseDecision(raw: string): ChairmanDecision | null {
  try {
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    return JSON.parse(cleaned) as ChairmanDecision;
  } catch {
    return null;
  }
}

// ─── Handle pending tasks ──────────────────────────────────────────────────

async function handlePendingTasks(
  sessionId: string,
  roomName: string,
  pendingTasks: RoomTask[],
  participants: Map<string, ParticipantInfo>
): Promise<void> {
  const context = buildContext(pendingTasks, participants);

  console.log(
    `[chairman] Routing ${pendingTasks.length} pending task(s) in room "${roomName}"`
  );
  const raw = await queryLmStudio(context);
  const decision = parseDecision(raw);

  if (!decision) {
    console.warn(`[chairman] Could not parse LLM response, posting raw`);
    await postMessage(sessionId, `[${CHAIRMAN_NAME}] ${raw}`);
    return;
  }

  switch (decision.action) {
    case "assign": {
      const summaryParts: string[] = [];
      for (const a of decision.assignments) {
        // Update task status in DB
        const updated = registry.updateTask(roomName, a.task_id, {
          status: "assigned",
          assignedTo: a.assigned_to,
        });
        if (updated) {
          summaryParts.push(`**${a.task_id}** -> ${a.assigned_to}`);
          console.log(`[chairman] DB: ${a.task_id} assigned to ${a.assigned_to}`);
        } else {
          console.warn(`[chairman] Failed to update task ${a.task_id} in DB`);
          summaryParts.push(`**${a.task_id}** -> ${a.assigned_to} (DB update failed)`);
        }
      }

      // Post human-readable summary to conversation
      await postMessage(
        sessionId,
        `[${CHAIRMAN_NAME}] ${decision.reason}\n\n${summaryParts.join("\n")}`,
        { type: "assignment", assignments: decision.assignments }
      );
      break;
    }
    case "hold":
      await postMessage(
        sessionId,
        `[${CHAIRMAN_NAME}] ${decision.hold_message || "Holding -- agents busy."}`
      );
      console.log(`[chairman] Holding: ${decision.reason}`);
      break;
    case "clarify":
      await postMessage(
        sessionId,
        `[${CHAIRMAN_NAME}] ${decision.question || "Can you clarify the task?"}`
      );
      console.log(`[chairman] Clarifying: ${decision.reason}`);
      break;
  }
}

// ─── Poll loop ──────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  if (busy) return;
  if (!isEnabled()) return;

  const sessionId = getSessionId();
  if (!sessionId) return;

  try {
    // Determine which room to poll.  Prefer an explicit setting, fall back
    // to finding a room linked to the configured conversation session.
    let roomName = getConfiguredRoomName();
    if (!roomName) {
      roomName = findRoomForSession(sessionId) ?? "";
    }
    if (!roomName) return; // No room configured or linked — nothing to do

    // Announce on first enabled poll
    if (!hasAnnounced) {
      hasAnnounced = true;
      await postMessage(
        sessionId,
        `[${CHAIRMAN_NAME}] Online -- task router active.\n` +
          `- Model: \`${getModel()}\`\n` +
          `- Room: \`${roomName}\`\n` +
          `- Polling \`antchat_tasks\` for pending tasks every ${POLL_INTERVAL_MS}ms.`
      );
      console.log(`[chairman] Initial sync — room "${roomName}"`);
    }

    // Query DB for pending tasks instead of parsing message text
    const pendingTasks = getPendingTasks(roomName);
    if (pendingTasks.length === 0) return;

    const participants = getRoomParticipants(roomName);

    busy = true;
    try {
      await handlePendingTasks(sessionId, roomName, pendingTasks, participants);
    } finally {
      busy = false;
    }
  } catch (err) {
    console.warn(`[chairman] Poll error:`, err instanceof Error ? err.message : err);
  }
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export function startChairmanBridge(): void {
  if (intervalHandle) return;
  console.log(`[chairman] Bridge starting (poll every ${POLL_INTERVAL_MS}ms)`);
  startTerminalMonitor();
  startMessageBridge();
  startTaskWatchdog();
  intervalHandle = setInterval(poll, POLL_INTERVAL_MS);
  // Run first poll immediately
  poll().catch(() => {});
}

export function stopChairmanBridge(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log(`[chairman] Bridge stopped`);
  }
  stopTerminalMonitor();
  stopMessageBridge();
  stopTaskWatchdog();
}
