/**
 * Embedded Chair — runs inside the ANT daemon process.
 *
 * Ambient orchestrator that monitors ALL conversation sessions simultaneously:
 * - Broadcasts every message to all room participant terminals
 * - Detects @chatlead mentions and routes tasks via LM Studio
 * - Verifies assigned tasks are actively being worked on (cursor movement)
 * - Auto re-routes tasks in "reviewed-needs-work" status
 * - Announces presence once per room on first connect
 *
 * No room or session configuration required — Chair watches everything.
 * Auto-starts when chairman_enabled is "1" in server_state.
 */

import { nanoid } from "nanoid";
import type { Server } from "socket.io";
import db from "../db.js";
import { DbChatRegistry, type RoomTask, type ParticipantInfo } from "../db-chat-room-registry.js";
import { getPty, getTerminalOutputCursor } from "../pty-manager.js";
import { bus, type NewMessagePayload } from "../events/bus.js";
import { startTerminalMonitor, stopTerminalMonitor } from "./terminal-monitor.js";
import { startMessageBridge, stopMessageBridge } from "./message-bridge.js";
import { startTaskWatchdog, stopTaskWatchdog } from "./task-watchdog.js";

const LM_STUDIO_URL = process.env.LM_STUDIO_URL || "http://localhost:1234";
/** How often to run time-based checks (cursor staleness, reviewed-needs-work). */
const PERIODIC_CHECK_MS = parseInt(process.env.CHAIRMAN_PERIODIC_MS || "60000", 10);
const CHAIR_NAME = process.env.CHAIR_NAME ?? process.env.CHAIRMAN_NAME ?? "@Chair";
// Strip leading @ for use as sender_name / agentName (prevents [@@Chatlead] in attribution)
const CHAIR_HANDLE = CHAIR_NAME.replace(/^@+/, "");

// Chair fires before task-watchdog (5min assigned / 15min silent)
const ASSIGNED_CURSOR_STALE_MS = parseInt(process.env.CHAIRMAN_ASSIGNED_STALE_MS || String(3 * 60 * 1000), 10);
const IN_PROGRESS_CURSOR_STALE_MS = parseInt(process.env.CHAIRMAN_INPROGRESS_STALE_MS || String(8 * 60 * 1000), 10);
const INJECT_GRACE_MS = parseInt(process.env.CHAIRMAN_INJECT_GRACE_MS || "6000", 10);

// ─── Types ───────────────────────────────────────────────────────────────────

interface AntMessage {
  id: string;
  role: string;
  content: string;
  sender_name?: string;
  created_at: string;
}

interface AssignmentItem {
  task_id: string;
  assigned_to: string;
  assigned_type: string;
  branch?: string;
}

interface ChairDecision {
  action: "assign" | "hold" | "clarify";
  reason: string;
  assignments: AssignmentItem[];
  hold_message?: string;
  question?: string;
}

interface DetectedTask {
  name: string;
  description: string;
}

interface MessageAnalysisResult {
  tasks: DetectedTask[];
  route_to: string[];   // agent handles, or ["all"], or []
  reason: string;
}

interface TaskCursorBaseline {
  cursor: number;
  recordedAt: number;
  terminalSessionId: string;
  assignedTo: string;
}

// ─── System prompt ──────────────────────────────────────────────────────────

const MESSAGE_ANALYSIS_PROMPT = `You are @Chair, orchestrator of a multi-agent development team.

For each incoming message, decide two things:

1. TASKS — does the message contain actionable work for specific agents?
   A task is: implement, fix, build, update, investigate, write, create, invite, or review something.
   Not a task: status updates, acknowledgements, chit-chat, or already-completed work.

   IMPORTANT — explicit assignments: if the message explicitly assigns work to named agents
   (e.g. "@MMDclaude and @MMDgem each do X"), create ONE task PER agent with the agent handle
   in the task name so it can be routed correctly (e.g. "MMDclaude: invite agents to ModelCheck",
   "MMDgem: invite agents to ModelCheck").

2. ROUTING — which specific agents need to see this message in their terminal?
   Only route to agents whose domain is directly relevant to the message content.
   Do NOT route to everyone by default — be selective.
   Use "all" only if the message is a blocker or announcement genuinely relevant to every participant.
   Use [] if no agent needs to see it (e.g. human-to-human conversation).
   You are the orchestrator — do NOT route messages to yourself.

You will receive the message and a list of available participants.

RESPOND ONLY WITH JSON:
{
  "tasks": [
    { "name": "<short imperative task name>", "description": "<one sentence context>" }
  ],
  "route_to": ["<agent-handle>", ...],
  "reason": "<one sentence explaining routing decision>"
}

tasks: [] if no actionable work.
route_to: [] if no agent routing needed.
route_to: ["all"] only when every participant genuinely needs it.`;

const SYSTEM_PROMPT = `You are @Chair, orchestrator of a multi-agent development team. You assign tasks to agents — you never execute tasks yourself.

You will be given a list of AVAILABLE PARTICIPANTS (from the room's DB) and
one or more PENDING TASKS that need to be assigned.

ROUTING RULES:
1. NEVER assign a task to yourself (Chair/Chatlead). You are the orchestrator only. If a task has no suitable agent, hold it.
2. If the task name starts with an agent handle (e.g. "MMDclaude: ..."), assign it to that agent.
3. Otherwise match task content to agent capabilities — skill, model, or stated role.
4. If the right agent is genuinely ambiguous, ask one clarifying question before routing.
5. Prefer available (non-busy) agents.

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
let periodicHandle: ReturnType<typeof setInterval> | null = null;
let lmStudioHealthy = true; // tracks last known state to avoid log spam
/** Socket.IO server reference — set in startChair, used by postMessage. */
let ioServer: Server | null = null;

// Per-session tracking so each conversation is monitored independently
const sessionLastSeenAt = new Map<string, string>();
const sessionProcessedIds = new Map<string, Set<string>>();

// Track which rooms have received the initial announcement (per process lifetime)
const announcedRooms = new Set<string>();

// Track which rooms Chair has joined as a participant (per process lifetime)
const joinedRooms = new Set<string>();

// Cursor baselines for assigned/in-progress task verification
const taskCursorBaselines = new Map<string, TaskCursorBaseline>();

// Registry instance — injected via startChair
let registry: DbChatRegistry;

// ─── Chair log session ───────────────────────────────────────────────────────

/** Session ID for the Chair's own log/monitor session. Null until ensured. */
let logSessionId: string | null = null;

/**
 * Looks up the "Chair" conversation session by name, creating it if absent.
 * Called once on startChair — result cached in logSessionId.
 */
function ensureLogSession(): void {
  const existing = db
    .prepare("SELECT id FROM sessions WHERE name = 'Chair' AND type IN ('chat', 'conversation') AND archived = 0")
    .get() as { id: string } | undefined;
  if (existing) {
    logSessionId = existing.id;
    return;
  }
  const id = nanoid(12);
  db.prepare(
    "INSERT INTO sessions (id, name, type, shell, cwd, workspace_id) VALUES (?, 'Chair', 'chat', NULL, NULL, NULL)"
  ).run(id);
  logSessionId = id;
  if (ioServer) ioServer.emit("session_list_changed");
}

type LogLevel = "info" | "warn" | "error";

const LEVEL_PREFIX: Record<LogLevel, string> = {
  info:  "ℹ",
  warn:  "⚠",
  error: "✖",
};

/**
 * Log to both console and the Chair monitor session.
 * High-frequency / low-signal lines (e.g. "no linked room") stay console-only.
 */
function chairLog(level: LogLevel, message: string): void {
  const consoleFn = level === "info" ? console.log : console.warn;
  consoleFn(`[chair] ${message}`);

  if (!logSessionId) return;
  const id = nanoid(12);
  const content = `${LEVEL_PREFIX[level]} ${message}`;
  db.prepare(`
    INSERT INTO messages (id, session_id, role, content, format, status, sender_type, sender_name)
    VALUES (?, ?, 'agent', ?, 'markdown', 'complete', 'agent', ?)
  `).run(id, logSessionId, content, CHAIR_HANDLE);

  if (ioServer) {
    const saved = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as any;
    ioServer.to(logSessionId).emit("message_created", saved);
  }
}

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

function getModel(): string {
  const model = getSetting("chairman_model", currentModel);
  if (model !== currentModel) {
    chairLog("info", `Model updated to: ${model}`);
    currentModel = model;
  }
  return currentModel;
}

// ─── Session discovery ───────────────────────────────────────────────────────

function getAllChatSessionIds(): string[] {
  const rows = db
    .prepare("SELECT id FROM sessions WHERE type IN ('conversation', 'chat', 'unified') AND archived = 0")
    .all() as { id: string }[];
  return rows.map((r) => r.id);
}

// ─── Routing audit trail ─────────────────────────────────────────────────────

function logRoutingEvent(
  sessionId: string,
  messageId: string | null,
  action: string,
  target: string,
  reason: string,
): void {
  try {
    db.prepare(`
      INSERT INTO routing_events (id, session_id, message_id, action, target, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(nanoid(12), sessionId, messageId, action, target, reason.slice(0, 500));
  } catch {
    // Non-critical — never let audit logging break the routing path
  }
}

// ─── Direct DB helpers (no self-fetch) ───────────────────────────────────────

function postMessage(sessionId: string, content: string, metadata?: any): void {
  const id = nanoid(12);
  const metaJson = metadata ? JSON.stringify(metadata) : null;
  db.prepare(`
    INSERT INTO messages (id, session_id, role, content, format, status, metadata, message_type, sender_type, sender_name)
    VALUES (?, ?, 'agent', ?, 'markdown', 'complete', ?, 'text', 'agent', ?)
  `).run(id, sessionId, content, metaJson, CHAIR_HANDLE);

  // Broadcast via Socket.IO so connected clients update in real-time.
  if (ioServer) {
    const saved = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as any;
    if (saved?.metadata) saved.metadata = JSON.parse(saved.metadata);
    ioServer.to(sessionId).emit("message_created", saved);
  }

  // Record routing event for audit trail.
  logRoutingEvent(sessionId, id, "post", metadata?.type ?? "message", content.slice(0, 120));
}

// ─── LM Studio health check ──────────────────────────────────────────────────

/**
 * Verifies LM Studio is reachable and has at least one model loaded.
 * Logs state transitions to the Chair session (not every poll cycle).
 * Returns true if healthy.
 */
async function verifyLmStudio(): Promise<boolean> {
  let healthy = false;
  let reason = "";
  try {
    const res = await fetch(`${LM_STUDIO_URL}/v1/models`);
    if (!res.ok) {
      reason = `HTTP ${res.status}`;
    } else {
      const data = (await res.json()) as { data: Array<{ id: string }> };
      if (!data.data?.length) {
        reason = "no model loaded";
      } else {
        healthy = true;
        if (!lmStudioHealthy) {
          chairLog("info", `LM Studio recovered — model: ${data.data[0].id}`);
        }
      }
    }
  } catch {
    reason = `not running at ${LM_STUDIO_URL}`;
  }

  if (!healthy && lmStudioHealthy) {
    // Only log on transition from healthy → unhealthy
    chairLog("warn", `LM Studio unavailable (${reason}) — routing paused until it recovers`);
  }
  lmStudioHealthy = healthy;
  return healthy;
}

// ─── DB queries ─────────────────────────────────────────────────────────────

function getPendingTasks(roomName: string): RoomTask[] {
  const room = registry.getRoom(roomName);
  if (!room) return [];
  return room.tasks.filter((t) => t.status === "pending" || t.status === "assigned");
}

function getRoomParticipants(roomName: string): Map<string, ParticipantInfo> {
  const room = registry.getRoom(roomName);
  if (!room) return new Map();
  return room.participants;
}

function findRoomForSession(sessionId: string): string | undefined {
  const rooms = registry.listRooms();
  const match = rooms.find((r) => r.conversationSessionId === sessionId);
  return match?.name;
}

// ─── Trigger detection ───────────────────────────────────────────────────────

function shouldRespond(msg: AntMessage): boolean {
  if (msg.role === "agent" && msg.sender_name === CHAIR_HANDLE) return false;
  const lc = msg.content.toLowerCase();
  return lc.includes("@chair") || lc.includes("@chatlead") || lc.includes("@chairman");
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

function parseDecision(raw: string): ChairDecision | null {
  try {
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    return JSON.parse(cleaned) as ChairDecision;
  } catch {
    return null;
  }
}

// ─── Message analysis: task detection + targeted routing ────────────────────

/**
 * For each new human message in a room-linked session, asks the LLM to:
 *   1. Detect any implicit tasks and create them in the DB
 *   2. Decide which specific agents need to see the message in their terminal
 *
 * Single LLM call combining both concerns. Best-effort — never throws.
 */
async function analyseAndRouteMessage(
  sessionId: string,
  roomName: string,
  msg: AntMessage
): Promise<void> {
  // Only analyse human messages — agents are responding, not requesting
  if (msg.role === "agent") return;
  if (msg.sender_name === CHAIR_HANDLE) return;

  const participants = getRoomParticipants(roomName);
  if (participants.size === 0) return;

  const participantList = Array.from(participants.entries())
    .map(([, info]) => `- ${info.agentName}${info.model ? ` (${info.model})` : ""}`)
    .join("\n");

  const userContent =
    `=== Participants ===\n${participantList}\n\n` +
    `=== Message from ${msg.sender_name ?? msg.role} ===\n${msg.content}`;

  const model = getModel();
  let raw: string;
  try {
    const res = await fetch(`${LM_STUDIO_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: MESSAGE_ANALYSIS_PROMPT },
          { role: "user", content: userContent },
        ],
        temperature: 0.2,
      }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    raw = data.choices[0]?.message?.content ?? "";
  } catch {
    return; // LM Studio unreachable — skip silently
  }

  let result: MessageAnalysisResult;
  try {
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    result = JSON.parse(cleaned) as MessageAnalysisResult;
  } catch {
    return;
  }

  // 1. Create any detected tasks and route them
  const createdTasks: string[] = [];
  for (const detected of result.tasks) {
    const task = registry.addTask(roomName, detected.name);
    if (task) {
      createdTasks.push(`**${task.id}** "${detected.name}"`);
      chairLog("info", `Detected task in room "${roomName}": "${detected.name}"`);
    }
  }

  if (createdTasks.length > 0) {
    postMessage(
      sessionId,
      `[${CHAIR_NAME}] Detected ${createdTasks.length} task(s):\n\n${createdTasks.join("\n")}\n\nRouting now…`
    );
    const pendingTasks = getPendingTasks(roomName);
    if (pendingTasks.length > 0) {
      await handlePendingTasks(sessionId, roomName, pendingTasks, participants);
    }
  }

  // 2. Inject message into the relevant agent terminals only
  if (result.route_to.length === 0) return;

  const formatted = `\n[@${msg.sender_name ?? msg.role} → ${roomName}]: ${msg.content}\n`;
  const routeAll = result.route_to.includes("all");

  const injections = Array.from(participants.entries())
    .filter(([, info]) => {
      const shouldRoute = routeAll || result.route_to.some(
        (handle) => handle.toLowerCase() === info.agentName.toLowerCase()
      );
      return shouldRoute && info.agentName.toLowerCase() !== (msg.sender_name ?? "").toLowerCase();
    })
    .map(([terminalSessionId]) => injectToTerminal(terminalSessionId, formatted));

  await Promise.all(injections);

  logRoutingEvent(sessionId, msg.id, "route", result.route_to.join(","), result.reason);
  chairLog("info", `Routed message to [${result.route_to.join(", ")}] — ${result.reason}`);
}

// ─── Terminal injection ──────────────────────────────────────────────────────

/**
 * Injects text into a terminal only if the agent hasn't already responded.
 * Records cursor before the grace period, waits, then checks again.
 * If the cursor advanced the agent is active — skip injection.
 * Never throws — safe to call without awaiting if you don't need the result.
 */
async function injectToTerminal(terminalSessionId: string, text: string): Promise<void> {
  try {
    const pty = getPty(terminalSessionId);
    if (!pty) return;

    const cursorBefore = getTerminalOutputCursor(terminalSessionId);
    await new Promise((r) => setTimeout(r, INJECT_GRACE_MS));

    // If cursor moved, the agent already reacted — don't double-deliver
    if (getTerminalOutputCursor(terminalSessionId) > cursorBefore) return;

    pty.write(text);
  } catch {
    // Terminal may have closed — ignore
  }
}

// ─── Register Chair as a room participant ────────────────────────────────────

/**
 * Ensures Chair appears in the room participant list.
 * Uses a stable pseudo session-id "chair" so it's idempotent.
 * Best-effort — never throws.
 */
function ensureInRoom(roomName: string): void {
  if (joinedRooms.has(roomName)) return;
  joinedRooms.add(roomName);
  try {
    // Use the registry directly — no HTTP round-trip.
    // Use the log session ID as the participant ID (a real session row) so FK constraints pass.
    // Falls back to a string sentinel if the log session hasn't been created yet.
    registry.addParticipant(roomName, logSessionId ?? "chair-sentinel", {
      agentName: CHAIR_HANDLE,
      model: "Chair",
      terminalName: "Chair",
    });
    chairLog("info", `Registered as participant in room "${roomName}"`);
  } catch (err) {
    joinedRooms.delete(roomName); // allow retry
    chairLog("warn", `Could not register in room "${roomName}": ${err instanceof Error ? err.message : err}`);
  }
}

// ─── First-connect room announcement ────────────────────────────────────────

/**
 * Posts a one-time announcement when Chair first encounters a room.
 * The add() is synchronous before the await to prevent double-announce
 * when multiple sessions resolve to the same room in a Promise.all cycle.
 */
function maybeAnnounceRoom(sessionId: string, roomName: string): void {
  if (announcedRooms.has(roomName)) return;
  announcedRooms.add(roomName);
  ensureInRoom(roomName);
  postMessage(
    sessionId,
    `[${CHAIR_NAME}] Now monitoring room **${roomName}**. ` +
      `I'll route tasks, broadcast messages to all participants, and verify work is progressing.`
  );
  chairLog("info", `Announced presence in room "${roomName}"`);
}

// ─── Task cursor baseline verification ──────────────────────────────────────

/**
 * Checks whether assigned/in-progress tasks are generating terminal activity.
 * If a task's assignee terminal hasn't advanced its output cursor within the
 * stale threshold, Chair escalates by re-routing via the LLM.
 */
async function checkTaskCursorBaselines(
  sessionId: string,
  roomName: string
): Promise<void> {
  const room = registry.getRoom(roomName);
  if (!room) return;

  const participants = room.participants;
  const now = Date.now();

  for (const task of room.tasks) {
    // Clean up baselines for tasks no longer in trackable states
    if (task.status !== "assigned" && task.status !== "in-progress") {
      taskCursorBaselines.delete(task.id);
      continue;
    }

    if (!task.assignedTo) continue;

    // Find the terminal session for the assignee
    const assigneeEntry = Array.from(participants.entries()).find(
      ([, info]) => info.agentName.toLowerCase() === task.assignedTo!.toLowerCase()
    );
    if (!assigneeEntry) continue;
    const [terminalSessionId] = assigneeEntry;

    const cursorNow = getTerminalOutputCursor(terminalSessionId);
    const existing = taskCursorBaselines.get(task.id);

    if (!existing) {
      // First time seeing this task — record baseline, check next cycle
      taskCursorBaselines.set(task.id, { cursor: cursorNow, recordedAt: now, terminalSessionId, assignedTo: task.assignedTo });
      continue;
    }

    // Assignee terminal changed (re-assignment) — reset baseline
    if (existing.terminalSessionId !== terminalSessionId) {
      taskCursorBaselines.set(task.id, { cursor: cursorNow, recordedAt: now, terminalSessionId, assignedTo: task.assignedTo });
      continue;
    }

    if (cursorNow > existing.cursor) {
      // Terminal is active — reset the "since last movement" clock
      taskCursorBaselines.set(task.id, { cursor: cursorNow, recordedAt: now, terminalSessionId, assignedTo: task.assignedTo });
      continue;
    }

    // Cursor has not advanced — check against threshold
    const threshold = task.status === "assigned" ? ASSIGNED_CURSOR_STALE_MS : IN_PROGRESS_CURSOR_STALE_MS;
    const elapsed = now - existing.recordedAt;
    if (elapsed < threshold) continue;

    // Stale — escalate to LLM for re-routing
    const elapsedMin = Math.round(elapsed / 60000);
    chairLog("warn", `Task ${task.id} stale (${elapsedMin}min, no terminal activity from ${task.assignedTo}) — escalating`);

    const staleContext =
      buildContext([task], participants) +
      `\n\n=== Situation ===\nTask "${task.name}" has been ${task.status} for ${elapsedMin} minutes ` +
      `with no terminal activity from ${task.assignedTo}. Re-assign to another available agent.`;

    const raw = await queryLmStudio(staleContext);
    const decision = parseDecision(raw);

    if (decision?.action === "assign") {
      for (const a of decision.assignments) {
        registry.updateTask(roomName, a.task_id, { status: "assigned", assignedTo: a.assigned_to });
        chairLog("info", `Re-assigned stale task ${a.task_id} to ${a.assigned_to}`);
      }
      postMessage(
        sessionId,
        `[${CHAIR_NAME}] Task **${task.name}** was stale (${elapsedMin}min). ${decision.reason}\n\n` +
          decision.assignments.map((a) => `**${a.task_id}** -> ${a.assigned_to}`).join("\n"),
        { type: "assignment", assignments: decision.assignments }
      );
    }

    // Reset baseline after escalation (prevents immediate re-escalation)
    taskCursorBaselines.set(task.id, { cursor: cursorNow, recordedAt: now, terminalSessionId, assignedTo: task.assignedTo });
  }
}

// ─── Reviewed-needs-work re-routing ─────────────────────────────────────────

/**
 * Detects tasks in "reviewed-needs-work" status and routes them back through
 * the LLM in a single batched call. Tasks stay in this status until the LLM
 * issues an assign decision.
 */
async function checkReviewedNeedsWork(
  sessionId: string,
  roomName: string
): Promise<void> {
  const room = registry.getRoom(roomName);
  if (!room) return;

  const needsWork = room.tasks.filter((t) => t.status === "reviewed-needs-work");
  if (needsWork.length === 0) return;

  chairLog("info", `${needsWork.length} task(s) in "reviewed-needs-work" in room "${roomName}" — re-routing`);

  const participants = room.participants;

  const participantLines = Array.from(participants.entries())
    .map(([sid, info]) => {
      const model = info.model ? ` (model: ${info.model})` : "";
      return `- ${info.agentName}${model} [session: ${sid}]`;
    })
    .join("\n");

  const taskLines = needsWork
    .map((t) => {
      const assignee = t.assignedTo ? ` (was assigned to: ${t.assignedTo})` : "";
      return `- [${t.id}] "${t.name}" — status: reviewed-needs-work${assignee}`;
    })
    .join("\n");

  const context =
    `=== Room Participants ===\n${participantLines || "(none)"}\n\n` +
    `=== Tasks Needing Re-Work ===\n${taskLines}\n\n` +
    `=== Instructions ===\nThese tasks were reviewed and need more work. ` +
    `Re-assign each to the most suitable available agent (can be the original assignee or different one).`;

  const raw = await queryLmStudio(context);
  const decision = parseDecision(raw);

  if (!decision || decision.action !== "assign") return; // hold/clarify: retry next cycle

  const summaryParts: string[] = [];
  for (const a of decision.assignments) {
    const updated = registry.updateTask(roomName, a.task_id, { status: "assigned", assignedTo: a.assigned_to });
    if (updated) summaryParts.push(`**${a.task_id}** -> ${a.assigned_to} (re-routed after review)`);
  }

  if (summaryParts.length > 0) {
    postMessage(
      sessionId,
      `[${CHAIR_NAME}] Re-routing tasks that need more work:\n\n${summaryParts.join("\n")}`,
      { type: "assignment", assignments: decision.assignments }
    );
  }
}

// ─── Handle pending tasks (DB-backed routing) ────────────────────────────────

async function handlePendingTasks(
  sessionId: string,
  roomName: string,
  pendingTasks: RoomTask[],
  participants: Map<string, ParticipantInfo>
): Promise<void> {
  const context = buildContext(pendingTasks, participants);

  chairLog("info", `Routing ${pendingTasks.length} pending task(s) in room "${roomName}"`);
  const raw = await queryLmStudio(context);
  const decision = parseDecision(raw);

  if (!decision) {
    chairLog("warn", `Could not parse LLM response, posting raw`);
    postMessage(sessionId, `[${CHAIR_NAME}] ${raw}`);
    return;
  }

  switch (decision.action) {
    case "assign": {
      const summaryParts: string[] = [];
      for (const a of decision.assignments) {
        const updated = registry.updateTask(roomName, a.task_id, {
          status: "assigned",
          assignedTo: a.assigned_to,
        });
        if (updated) {
          summaryParts.push(`**${a.task_id}** -> ${a.assigned_to}`);
          chairLog("info", `DB: ${a.task_id} assigned to ${a.assigned_to}`);
        } else {
          chairLog("warn", `Failed to update task ${a.task_id} in DB`);
          summaryParts.push(`**${a.task_id}** -> ${a.assigned_to} (DB update failed)`);
        }
      }
      postMessage(
        sessionId,
        `[${CHAIR_NAME}] ${decision.reason}\n\n${summaryParts.join("\n")}`,
        { type: "assignment", assignments: decision.assignments }
      );
      break;
    }
    case "hold":
      postMessage(sessionId, `[${CHAIR_NAME}] ${decision.hold_message || "Holding -- agents busy."}`);
      chairLog("info", `Holding: ${decision.reason}`);
      break;
    case "clarify":
      postMessage(sessionId, `[${CHAIR_NAME}] ${decision.question || "Can you clarify the task?"}`);
      chairLog("info", `Clarifying: ${decision.reason}`);
      break;
  }
}

// ─── Handle a triggering message in a session ────────────────────────────────

async function handleMessage(sessionId: string, msg: AntMessage): Promise<void> {
  const roomName = findRoomForSession(sessionId);
  if (!roomName) {
    console.log(`[chair] Session ${sessionId} has no linked room — skipping`);
    return;
  }

  const pendingTasks = getPendingTasks(roomName);
  const participants = getRoomParticipants(roomName);

  if (pendingTasks.length === 0) {
    console.log(`[chair] @mention in session ${sessionId} but no pending tasks in room "${roomName}"`);
    return;
  }

  await handlePendingTasks(sessionId, roomName, pendingTasks, participants);
}

// ─── Event-driven message handler ────────────────────────────────────────────

async function onNewMessage(payload: NewMessagePayload): Promise<void> {
  if (!isEnabled()) return;
  if (busy) return; // one inflight LLM call at a time

  const { sessionId, id, role, content, sender_name, created_at } = payload;

  // Deduplicate
  const processedIds = sessionProcessedIds.get(sessionId) ?? new Set<string>();
  sessionProcessedIds.set(sessionId, processedIds);
  if (processedIds.has(id)) return;
  processedIds.add(id);
  sessionLastSeenAt.set(sessionId, created_at);

  const msg: AntMessage = { id, role, content, sender_name: sender_name ?? undefined, created_at };

  const roomName = findRoomForSession(sessionId);
  if (!roomName) return; // only act on room-linked sessions

  maybeAnnounceRoom(sessionId, roomName);

  busy = true;
  try {
    await analyseAndRouteMessage(sessionId, roomName, msg);
    if (shouldRespond(msg)) await handleMessage(sessionId, msg);
  } catch (err) {
    chairLog("error", `Handler error: ${err instanceof Error ? err.message : err}`);
  } finally {
    busy = false;
  }
}

// ─── Periodic checks (inherently time-based) ─────────────────────────────────

async function runPeriodicChecks(): Promise<void> {
  if (!isEnabled()) return;
  await verifyLmStudio();

  const sessionIds = getAllChatSessionIds();
  for (const sessionId of sessionIds) {
    const roomName = findRoomForSession(sessionId);
    if (!roomName) continue;
    try {
      await checkTaskCursorBaselines(sessionId, roomName);
      await checkReviewedNeedsWork(sessionId, roomName);
    } catch (err) {
      chairLog("warn", `Periodic check error for session ${sessionId}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/** Called by the toggle route when Chair is enabled — runs an immediate health check. */
export function triggerLmStudioCheck(): void {
  verifyLmStudio().catch(() => {});
}

export function startChair(io: Server, registryInstance: DbChatRegistry): void {
  if (periodicHandle) return;
  ioServer = io;
  registry = registryInstance;
  ensureLogSession();
  chairLog("info", `Starting — event-driven, periodic checks every ${PERIODIC_CHECK_MS}ms`);
  verifyLmStudio().catch(() => {});
  bus.on("message:new", (payload) => {
    onNewMessage(payload).catch((err) => {
      console.warn("[chair] Unhandled error in onNewMessage:", err instanceof Error ? err.message : err);
    });
  });
  startTerminalMonitor();
  startMessageBridge();
  startTaskWatchdog();
  periodicHandle = setInterval(() => {
    runPeriodicChecks().catch(() => {});
  }, PERIODIC_CHECK_MS);
}

export function stopChair(): void {
  if (!periodicHandle) return;
  clearInterval(periodicHandle);
  periodicHandle = null;
  bus.off("message:new", onNewMessage as (payload: NewMessagePayload) => void);
  ioServer = null;
  sessionLastSeenAt.clear();
  sessionProcessedIds.clear();
  announcedRooms.clear();
  joinedRooms.clear();
  taskCursorBaselines.clear();
  chairLog("info", "Stopped");
  logSessionId = null;
  stopTerminalMonitor();
  stopMessageBridge();
  stopTaskWatchdog();
}
