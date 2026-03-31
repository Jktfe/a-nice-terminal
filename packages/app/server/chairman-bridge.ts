/**
 * Embedded Chairman Bridge — runs inside the ANT server process.
 *
 * Ambient orchestrator that monitors ALL conversation sessions simultaneously:
 * - Broadcasts every message to all room participant terminals
 * - Detects @chatlead mentions and routes tasks via LM Studio
 * - Verifies assigned tasks are actively being worked on (cursor movement)
 * - Auto re-routes tasks in "reviewed-needs-work" status
 * - Announces presence once per room on first connect
 *
 * No room or session configuration required — Chairman watches everything.
 * Auto-starts when chairman_enabled is "1" in server_state.
 */

import db from "./db.js";
import { DbChatRoomRegistry, type RoomTask, type ParticipantInfo } from "./db-chat-room-registry.js";
import { getPty, getTerminalOutputCursor } from "./pty-manager.js";
import { startTerminalMonitor, stopTerminalMonitor } from "./terminal-monitor.js";
import { startMessageBridge, stopMessageBridge } from "./message-bridge.js";
import { startTaskWatchdog, stopTaskWatchdog } from "./task-watchdog.js";

const ANT_URL = `http://localhost:${process.env.ANT_PORT || "6458"}`;
const LM_STUDIO_URL = process.env.LM_STUDIO_URL || "http://localhost:1234";
const POLL_INTERVAL_MS = parseInt(process.env.CHAIRMAN_POLL_MS || "4000", 10);
const CHAIRMAN_NAME = process.env.CHAIRMAN_NAME || "@Chatlead";

// Chairman fires before task-watchdog (5min assigned / 15min silent)
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

interface ChairmanDecision {
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

// ─── DB Registry ────────────────────────────────────────────────────────────

const registry = new DbChatRoomRegistry(db);

// ─── System prompt ──────────────────────────────────────────────────────────

const MESSAGE_ANALYSIS_PROMPT = `You are @Chatlead, Chairman of a multi-agent development team.

For each incoming message, decide two things:

1. TASKS — does the message contain actionable work to assign?
   A task is: implement, fix, build, update, investigate, write, create, or review something.
   Not a task: status updates, acknowledgements, chit-chat, or already-completed work.

2. ROUTING — which specific agents need to see this message in their terminal?
   Only route to agents whose domain is directly relevant to the message content.
   Do NOT route to everyone by default — be selective.
   Use "all" only if the message is a blocker or announcement genuinely relevant to every participant.
   Use [] if no agent needs to see it (e.g. human-to-human conversation).

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

const SYSTEM_PROMPT = `You are @Chatlead, the Chairman and task router in a multi-agent development team.

You will be given a list of AVAILABLE PARTICIPANTS (from the room's DB) and
one or more PENDING TASKS that need to be assigned.

ROUTING RULES:
1. Match task content to agent capabilities — read the task description and assign to the agent best suited by skill, model, or stated role. Do not route based on session name prefixes.
2. If the right agent is genuinely ambiguous, ask one clarifying question before routing
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

// Per-session tracking so each conversation is monitored independently
const sessionLastSeenAt = new Map<string, string>();
const sessionProcessedIds = new Map<string, Set<string>>();

// Track which rooms have received the initial announcement (per process lifetime)
const announcedRooms = new Set<string>();

// Cursor baselines for assigned/in-progress task verification
const taskCursorBaselines = new Map<string, TaskCursorBaseline>();

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
    console.log(`[chairman] Model updated to: ${model}`);
    currentModel = model;
  }
  return currentModel;
}

// ─── Session discovery ───────────────────────────────────────────────────────

function getAllChatSessionIds(): string[] {
  const rows = db
    .prepare("SELECT id FROM sessions WHERE type IN ('conversation', 'unified') AND archived = 0")
    .all() as { id: string }[];
  return rows.map((r) => r.id);
}

// ─── ANT API ─────────────────────────────────────────────────────────────────

async function fetchMessages(sessionId: string): Promise<AntMessage[]> {
  const res = await fetch(`${ANT_URL}/api/sessions/${sessionId}/messages`);
  if (!res.ok) throw new Error(`ANT ${res.status}: ${await res.text()}`);
  return res.json() as Promise<AntMessage[]>;
}

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
  if (msg.role === "agent" && msg.sender_name === CHAIRMAN_NAME) return false;
  const lc = msg.content.toLowerCase();
  return lc.includes("@chatlead") || lc.includes("@chairman");
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
  if (msg.sender_name === CHAIRMAN_NAME) return;

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
      console.log(`[chairman] Detected task in room "${roomName}": "${detected.name}"`);
    }
  }

  if (createdTasks.length > 0) {
    await postMessage(
      sessionId,
      `[${CHAIRMAN_NAME}] Detected ${createdTasks.length} task(s):\n\n${createdTasks.join("\n")}\n\nRouting now…`
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

  console.log(
    `[chairman] Routed message to [${result.route_to.join(", ")}] — ${result.reason}`
  );
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

// ─── First-connect room announcement ────────────────────────────────────────

/**
 * Posts a one-time announcement when Chairman first encounters a room.
 * The add() is synchronous before the await to prevent double-announce
 * when multiple sessions resolve to the same room in a Promise.all cycle.
 */
async function maybeAnnounceRoom(sessionId: string, roomName: string): Promise<void> {
  if (announcedRooms.has(roomName)) return;
  announcedRooms.add(roomName);
  await postMessage(
    sessionId,
    `[${CHAIRMAN_NAME}] Now monitoring room **${roomName}**. ` +
      `I'll route tasks, broadcast messages to all participants, and verify work is progressing.`
  );
  console.log(`[chairman] Announced presence in room "${roomName}"`);
}

// ─── Task cursor baseline verification ──────────────────────────────────────

/**
 * Checks whether assigned/in-progress tasks are generating terminal activity.
 * If a task's assignee terminal hasn't advanced its output cursor within the
 * stale threshold, Chairman escalates by re-routing via the LLM.
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
    console.log(`[chairman] Task ${task.id} stale (${elapsedMin}min, no terminal activity from ${task.assignedTo}) — escalating`);

    const staleContext =
      buildContext([task], participants) +
      `\n\n=== Situation ===\nTask "${task.name}" has been ${task.status} for ${elapsedMin} minutes ` +
      `with no terminal activity from ${task.assignedTo}. Re-assign to another available agent.`;

    const raw = await queryLmStudio(staleContext);
    const decision = parseDecision(raw);

    if (decision?.action === "assign") {
      for (const a of decision.assignments) {
        registry.updateTask(roomName, a.task_id, { status: "assigned", assignedTo: a.assigned_to });
        console.log(`[chairman] Re-assigned stale task ${a.task_id} to ${a.assigned_to}`);
      }
      await postMessage(
        sessionId,
        `[${CHAIRMAN_NAME}] Task **${task.name}** was stale (${elapsedMin}min). ${decision.reason}\n\n` +
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

  console.log(`[chairman] ${needsWork.length} task(s) in "reviewed-needs-work" in room "${roomName}" — re-routing`);

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
    await postMessage(
      sessionId,
      `[${CHAIRMAN_NAME}] Re-routing tasks that need more work:\n\n${summaryParts.join("\n")}`,
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

  console.log(`[chairman] Routing ${pendingTasks.length} pending task(s) in room "${roomName}"`);
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
      await postMessage(
        sessionId,
        `[${CHAIRMAN_NAME}] ${decision.reason}\n\n${summaryParts.join("\n")}`,
        { type: "assignment", assignments: decision.assignments }
      );
      break;
    }
    case "hold":
      await postMessage(sessionId, `[${CHAIRMAN_NAME}] ${decision.hold_message || "Holding -- agents busy."}`);
      console.log(`[chairman] Holding: ${decision.reason}`);
      break;
    case "clarify":
      await postMessage(sessionId, `[${CHAIRMAN_NAME}] ${decision.question || "Can you clarify the task?"}`);
      console.log(`[chairman] Clarifying: ${decision.reason}`);
      break;
  }
}

// ─── Handle a triggering message in a session ────────────────────────────────

async function handleMessage(sessionId: string, msg: AntMessage): Promise<void> {
  const roomName = findRoomForSession(sessionId);
  if (!roomName) {
    console.log(`[chairman] Session ${sessionId} has no linked room — skipping`);
    return;
  }

  const pendingTasks = getPendingTasks(roomName);
  const participants = getRoomParticipants(roomName);

  if (pendingTasks.length === 0) {
    console.log(`[chairman] @mention in session ${sessionId} but no pending tasks in room "${roomName}"`);
    return;
  }

  await handlePendingTasks(sessionId, roomName, pendingTasks, participants);
}

// ─── Per-session poll ────────────────────────────────────────────────────────

async function pollSession(sessionId: string): Promise<void> {
  try {
    const messages = await fetchMessages(sessionId);
    if (messages.length === 0) return;

    // First time seeing this session — snapshot current state, don't process old messages
    if (!sessionLastSeenAt.has(sessionId)) {
      sessionLastSeenAt.set(sessionId, messages[messages.length - 1].created_at);
      sessionProcessedIds.set(sessionId, new Set(messages.map((m) => m.id)));
      return;
    }

    // Proactive room-linked checks (run every cycle regardless of new messages)
    const roomName = findRoomForSession(sessionId);
    if (roomName) {
      await maybeAnnounceRoom(sessionId, roomName);
      await checkTaskCursorBaselines(sessionId, roomName);
      await checkReviewedNeedsWork(sessionId, roomName);
    }

    const lastSeen = sessionLastSeenAt.get(sessionId)!;
    const processedIds = sessionProcessedIds.get(sessionId) ?? new Set<string>();

    const newMessages = messages.filter(
      (m) => m.created_at > lastSeen && !processedIds.has(m.id)
    );
    if (newMessages.length === 0) return;

    sessionLastSeenAt.set(sessionId, messages[messages.length - 1].created_at);
    for (const m of newMessages) processedIds.add(m.id);

    // Analyse each new message: detect tasks + route to relevant agents only
    if (roomName) {
      for (const msg of newMessages) {
        await analyseAndRouteMessage(sessionId, roomName, msg);
      }
    }

    // Explicit @chatlead/@chairman trigger — route any remaining pending tasks
    const toHandle = newMessages.find(shouldRespond);
    if (toHandle) await handleMessage(sessionId, toHandle);
  } catch (err) {
    console.warn(`[chairman] Poll error for session ${sessionId}:`, err instanceof Error ? err.message : err);
  }
}

// ─── Poll loop ──────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  if (busy) return;
  if (!isEnabled()) return;

  const sessionIds = getAllChatSessionIds();
  if (sessionIds.length === 0) return;

  busy = true;
  try {
    await Promise.all(sessionIds.map(pollSession));
  } finally {
    busy = false;
  }
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export function startChairmanBridge(): void {
  if (intervalHandle) return;
  console.log(`[chairman] Bridge starting (poll every ${POLL_INTERVAL_MS}ms, watching all sessions)`);
  startTerminalMonitor();
  startMessageBridge();
  startTaskWatchdog();
  intervalHandle = setInterval(poll, POLL_INTERVAL_MS);
  poll().catch(() => {});
}

export function stopChairmanBridge(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    sessionLastSeenAt.clear();
    sessionProcessedIds.clear();
    announcedRooms.clear();
    taskCursorBaselines.clear();
    console.log(`[chairman] Bridge stopped`);
  }
  stopTerminalMonitor();
  stopMessageBridge();
  stopTaskWatchdog();
}
