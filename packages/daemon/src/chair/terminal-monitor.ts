/**
 * Terminal Monitor — detects Claude Code permission prompts in active
 * terminal screens and posts terminal_approval cards to the most recently
 * active Chat session.
 *
 * No polling. Listens to the daemon event bus and fires when a PTY produces
 * output. Per-session debounce (500 ms) prevents re-checking on every byte.
 *
 * No room or session configuration required — monitors every terminal.
 * Started/stopped by Chair alongside the chat routing loop.
 */

import crypto from "node:crypto";
import type { Server } from "socket.io";
import { nanoid } from "nanoid";
import db from "../db.js";
import { bus, type TerminalOutputPayload } from "../events/bus.js";
import { getHeadless } from "../pty-manager.js";

// ─── Socket.IO reference (set from index.ts after server starts) ──────────────

let ioServer: Server | null = null;
export function setIo(server: Server): void {
  ioServer = server;
}

const CHAIR_NAME = process.env.CHAIR_NAME ?? process.env.CHAIRMAN_NAME ?? "@Chatlead";
/** How long after the last output byte before we check the screen for prompts. */
const DEBOUNCE_MS = parseInt(process.env.TERMINAL_MONITOR_DEBOUNCE_MS || "500", 10);

// ─── Pure helper functions (exported for tests) ──────────────────────────────

const PROMPT_PATTERNS = [
  "Do you want to proceed",
  "Allow this action",
  "Allow bash",
  "Allow tool",
];

const TOOL_NAMES = ["Bash", "Edit", "Write", "Read", "WebFetch", "MultiEdit"];

export function detectPrompt(lines: string[]): boolean {
  const screen = lines.join("\n");
  const hasPromptText = PROMPT_PATTERNS.some((p) => screen.includes(p));
  const hasYesOption =
    screen.includes("❯ Yes") ||
    screen.includes("❯ Yes, allow") ||
    (screen.includes("Allow") && screen.includes("❯"));
  return hasPromptText || hasYesOption;
}

export function extractToolType(lines: string[]): string {
  const screen = lines.join(" ");
  for (const tool of TOOL_NAMES) {
    if (screen.toLowerCase().includes(tool.toLowerCase())) return tool;
  }
  return "Unknown";
}

export function extractDetail(lines: string[], toolType: string): string {
  const toolIdx = lines.findIndex((l) =>
    l.toLowerCase().includes(toolType.toLowerCase())
  );
  if (toolIdx === -1 || toolIdx + 1 >= lines.length) return "";
  const detail = lines[toolIdx + 1].trim();
  return detail.slice(0, 200);
}

export function buildPromptId(sessionId: string, toolType: string, detail: string): string {
  return crypto
    .createHash("sha1")
    .update(`${sessionId}:${toolType}:${detail}`)
    .digest("hex")
    .slice(0, 12);
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

function getMostActiveChatSessionId(): string | null {
  const row = db
    .prepare(`
      SELECT s.id
      FROM sessions s
      WHERE s.type IN ('conversation', 'unified') AND s.archived = 0
      ORDER BY (
        SELECT MAX(created_at) FROM messages WHERE session_id = s.id
      ) DESC
      LIMIT 1
    `)
    .get() as { id: string } | undefined;
  return row?.id ?? null;
}

function getTerminalName(terminalSessionId: string): string {
  const row = db
    .prepare("SELECT name FROM sessions WHERE id = ?")
    .get(terminalSessionId) as { name: string } | undefined;
  return row?.name ?? terminalSessionId;
}

function isEnabled(): boolean {
  const row = db
    .prepare("SELECT value FROM server_state WHERE key = ?")
    .get("chairman_enabled") as { value: string } | undefined;
  return row?.value === "1";
}

// ─── Direct DB message insert (replaces self-fetch POST) ─────────────────────

function insertApprovalCard(
  sessionId: string,
  terminalId: string,
  terminalName: string,
  toolType: string,
  detail: string,
  promptId: string,
): void {
  const id = nanoid(12);
  const content = `**${CHAIR_NAME}** — Terminal approval required\n\n**${toolType}**: \`${detail || "(no detail)"}\`\n\nUse the card below to respond.`;
  const metadata = JSON.stringify({
    type: "terminal_approval",
    terminal_id: terminalId,
    terminal_name: terminalName,
    tool_type: toolType,
    detail,
    prompt_id: promptId,
    status: "pending",
  });

  db.prepare(`
    INSERT INTO messages (id, session_id, role, content, format, status, metadata, message_type, sender_type, sender_name)
    VALUES (?, ?, 'agent', ?, 'markdown', 'complete', ?, 'text', 'agent', ?)
  `).run(id, sessionId, content, metadata, CHAIR_NAME);

  // Notify clients via Socket.IO directly — no HTTP round-trip.
  if (ioServer) {
    const saved = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as any;
    if (saved?.metadata) saved.metadata = JSON.parse(saved.metadata);
    ioServer.to(sessionId).emit("message_created", saved);
  }
}

// ─── State — per-session debounce timers and seen-prompt dedup ────────────────

const seenPrompts = new Set<string>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ─── Handler ─────────────────────────────────────────────────────────────────

function checkTerminal(sessionId: string): void {
  if (!isEnabled()) return;

  const headless = getHeadless(sessionId);
  if (!headless) return;

  const lines = headless.getScreenLines();
  if (!detectPrompt(lines)) return;

  const toolType = extractToolType(lines);
  const detail = extractDetail(lines, toolType);
  const promptId = buildPromptId(sessionId, toolType, detail);

  if (seenPrompts.has(promptId)) return;
  seenPrompts.add(promptId);

  const targetSessionId = getMostActiveChatSessionId();
  if (!targetSessionId) return;

  const terminalName = getTerminalName(sessionId);
  insertApprovalCard(targetSessionId, sessionId, terminalName, toolType, detail, promptId);

  if (ioServer) {
    ioServer.emit("terminal_approval_needed", { sessionId, promptId, toolType });
  }

  console.log(
    `[terminal-monitor] Approval card posted for terminal "${terminalName}": ${toolType} — ${detail.slice(0, 50)}`
  );
}

function handleTerminalOutput(payload: TerminalOutputPayload): void {
  const { sessionId } = payload;

  // Debounce: cancel previous timer for this session, schedule a fresh check.
  const existing = debounceTimers.get(sessionId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    debounceTimers.delete(sessionId);
    try {
      checkTerminal(sessionId);
    } catch (err) {
      console.warn("[terminal-monitor] Check error:", err instanceof Error ? err.message : err);
    }
  }, DEBOUNCE_MS);

  debounceTimers.set(sessionId, timer);
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let started = false;

export function startTerminalMonitor(): void {
  if (started) return;
  started = true;
  bus.on("terminal:output", handleTerminalOutput);
  console.log("[terminal-monitor] Started (event-driven, debounce " + DEBOUNCE_MS + "ms)");
}

export function stopTerminalMonitor(): void {
  if (!started) return;
  bus.off("terminal:output", handleTerminalOutput);
  for (const t of debounceTimers.values()) clearTimeout(t);
  debounceTimers.clear();
  seenPrompts.clear();
  started = false;
  console.log("[terminal-monitor] Stopped");
}
