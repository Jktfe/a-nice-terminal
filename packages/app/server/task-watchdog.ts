/**
 * Task Watchdog — monitors in-progress task assignments, detects idle agents,
 * and nudges them in both chat and their terminal.
 *
 * Gap detection:
 * - Idle in_progress task: terminal cursor hasn't advanced in IDLE_MS
 * - Unstarted assignment: todo task with assigned_name older than UNSTARTED_MS
 * - Silent agent: terminal active but no chat message in SILENT_MS
 */

import db from "./db.js";
import { getPty, getTerminalOutputCursor } from "./pty-manager.js";

const ANT_URL = `http://localhost:${process.env.ANT_PORT || "6458"}`;
const POLL_INTERVAL_MS = parseInt(process.env.WATCHDOG_POLL_MS || "30000", 10);
const IDLE_MS = parseInt(process.env.WATCHDOG_IDLE_MS || String(5 * 60 * 1000), 10);
const UNSTARTED_MS = parseInt(process.env.WATCHDOG_UNSTARTED_MS || String(3 * 60 * 1000), 10);
const SILENT_MS = parseInt(process.env.WATCHDOG_SILENT_MS || String(15 * 60 * 1000), 10);
const COOLDOWN_MS = parseInt(process.env.WATCHDOG_COOLDOWN_MS || String(10 * 60 * 1000), 10);
const CHAIRMAN_NAME = process.env.CHAIRMAN_NAME || "@Chatlead";

// ─── Pure helpers (exported for tests) ───────────────────────────────────────

export function isIdleOnTask(
  cursorAtAssign: number,
  cursorNow: number,
  assignedAt: Date,
  idleThresholdMs: number
): boolean {
  const elapsed = Date.now() - assignedAt.getTime();
  return elapsed >= idleThresholdMs && cursorNow <= cursorAtAssign;
}

export function needsStartNudge(
  status: string,
  assignedAt: Date,
  unstartedThresholdMs: number
): boolean {
  if (status !== "todo") return false;
  return Date.now() - assignedAt.getTime() >= unstartedThresholdMs;
}

export function needsSilentNudge(
  cursorAtLastNudge: number,
  cursorNow: number,
  lastChatAt: Date,
  silentThresholdMs: number
): boolean {
  const terminalActive = cursorNow > cursorAtLastNudge;
  const noRecentChat = Date.now() - lastChatAt.getTime() >= silentThresholdMs;
  return terminalActive && noRecentChat;
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

// ─── Types ───────────────────────────────────────────────────────────────────

interface WatchedTask {
  taskId: string;
  assignedHandle: string;
  terminalSessionId: string;
  assignedAt: Date;
  cursorAtAssign: number;
  nudgedAt: Date | null;
  cursorAtLastNudge: number;
  lastChatAt: Date;
}

interface Participant {
  terminalSessionId: string;
  agentName: string;
}

// ─── State ───────────────────────────────────────────────────────────────────

const watchedTasks = new Map<string, WatchedTask>();
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let busy = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

async function postChat(sessionId: string, content: string): Promise<void> {
  await fetch(`${ANT_URL}/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "agent",
      content,
      format: "markdown",
      status: "complete",
      sender_name: CHAIRMAN_NAME,
      sender_type: "agent",
    }),
  });
}

function injectTerminal(terminalSessionId: string, text: string): void {
  const pty = getPty(terminalSessionId);
  if (!pty) return;
  try {
    pty.write(text + "\n");
  } catch {
    // Terminal may have closed — ignore
  }
}

function minutesAgo(ms: number): string {
  return `${Math.round(ms / 60000)} min${ms >= 120000 ? "s" : ""}`;
}

function canNudge(task: WatchedTask): boolean {
  if (!task.nudgedAt) return true;
  return Date.now() - task.nudgedAt.getTime() >= COOLDOWN_MS;
}

function getLastAgentChatTime(sessionId: string, agentHandle: string): Date {
  const row = db
    .prepare(
      `SELECT created_at FROM messages
       WHERE session_id = ? AND sender_name = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(sessionId, agentHandle) as { created_at: string } | undefined;
  return row ? new Date(row.created_at + "Z") : new Date(0);
}

// ─── Poll ────────────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  if (busy) return;
  if (!isEnabled()) return;

  const sessionId = getSessionId();
  const roomName = getRoomName();
  if (!sessionId || !roomName) return;

  busy = true;
  try {
    const participants = await getRoomParticipants(roomName);
    const participantMap = new Map(participants.map((p) => [p.agentName.toLowerCase(), p]));

    type DbTask = {
      id: string;
      title: string;
      status: string;
      assigned_name: string | null;
      updated_at: string;
    };
    const tasks = db
      .prepare(
        "SELECT id, title, status, assigned_name, updated_at FROM tasks WHERE assigned_name IS NOT NULL AND status != 'done'"
      )
      .all() as DbTask[];

    for (const task of tasks) {
      const handle = task.assigned_name!;
      const participant = participantMap.get(handle.replace("@", "").toLowerCase()) ??
        participantMap.get(handle.toLowerCase());
      if (!participant) continue;

      const cursorNow = getTerminalOutputCursor(participant.terminalSessionId);
      const elapsed = Date.now() - new Date(task.updated_at + "Z").getTime();

      // Register new task
      if (!watchedTasks.has(task.id)) {
        watchedTasks.set(task.id, {
          taskId: task.id,
          assignedHandle: handle,
          terminalSessionId: participant.terminalSessionId,
          assignedAt: new Date(task.updated_at + "Z"),
          cursorAtAssign: cursorNow,
          nudgedAt: null,
          cursorAtLastNudge: cursorNow,
          lastChatAt: getLastAgentChatTime(sessionId, handle),
        });
        continue;
      }

      const watched = watchedTasks.get(task.id)!;
      if (!canNudge(watched)) continue;

      if (task.status === "done") {
        watchedTasks.delete(task.id);
        continue;
      }

      const elapsedMsg = minutesAgo(elapsed);

      // 1. Idle on in_progress task
      if (
        task.status === "in_progress" &&
        isIdleOnTask(watched.cursorAtAssign, cursorNow, watched.assignedAt, IDLE_MS)
      ) {
        const chatMsg = `**[@Chatlead]** ${handle} — \`${task.title}\` has been in_progress for ${elapsedMsg} with no terminal activity. Working on it?`;
        const termMsg = `[Chatlead] Task "${task.title}" (in_progress ${elapsedMsg}) — please post a status update in chat.`;
        await postChat(sessionId, chatMsg);
        injectTerminal(participant.terminalSessionId, termMsg);
        watched.nudgedAt = new Date();
        watched.cursorAtLastNudge = cursorNow;
        console.log(`[task-watchdog] Nudged ${handle} on task ${task.id} (idle)`);
        continue;
      }

      // 2. Unstarted assignment
      if (needsStartNudge(task.status, watched.assignedAt, UNSTARTED_MS)) {
        const chatMsg = `**[@Chatlead]** ${handle} — \`${task.title}\` was assigned ${elapsedMsg} ago but hasn't been started. Ready to begin?`;
        const termMsg = `[Chatlead] Task "${task.title}" assigned ${elapsedMsg} ago — please start when ready.`;
        await postChat(sessionId, chatMsg);
        injectTerminal(participant.terminalSessionId, termMsg);
        watched.nudgedAt = new Date();
        console.log(`[task-watchdog] Nudged ${handle} on task ${task.id} (unstarted)`);
        continue;
      }

      // 3. Terminal active but no chat update
      const lastChatAt = getLastAgentChatTime(sessionId, handle);
      if (needsSilentNudge(watched.cursorAtLastNudge, cursorNow, lastChatAt, SILENT_MS)) {
        const chatMsg = `**[@Chatlead]** ${handle} — terminal shows activity on \`${task.title}\` but no chat update in ${minutesAgo(SILENT_MS)}. How's it going?`;
        await postChat(sessionId, chatMsg);
        watched.nudgedAt = new Date();
        watched.cursorAtLastNudge = cursorNow;
        watched.lastChatAt = lastChatAt;
        console.log(`[task-watchdog] Nudged ${handle} on task ${task.id} (silent)`);
      }
    }

    // Clean up tasks no longer in DB
    for (const taskId of watchedTasks.keys()) {
      if (!tasks.find((t) => t.id === taskId)) {
        watchedTasks.delete(taskId);
      }
    }
  } catch (err) {
    console.warn("[task-watchdog] Poll error:", err instanceof Error ? err.message : err);
  } finally {
    busy = false;
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export function startTaskWatchdog(): void {
  if (intervalHandle) return;
  console.log(`[task-watchdog] Starting (poll every ${POLL_INTERVAL_MS}ms)`);
  intervalHandle = setInterval(poll, POLL_INTERVAL_MS);
  poll().catch(() => {});
}

export function stopTaskWatchdog(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("[task-watchdog] Stopped");
  }
}
