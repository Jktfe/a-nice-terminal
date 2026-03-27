/**
 * Terminal Monitor — polls headless terminal screen lines for Claude Code
 * permission prompts and posts terminal_approval cards to the watched
 * chairman chat session.
 *
 * Started/stopped by chairman-bridge alongside the chat routing loop.
 * Reads chairman_enabled + chairman_session + chairman_room from server_state
 * on every cycle — no restart needed to reconfigure.
 */

import crypto from "crypto";
import db from "./db.js";
import { getHeadless } from "./pty-manager.js";

const ANT_URL = `http://localhost:${process.env.ANT_PORT || "6458"}`;
const POLL_INTERVAL_MS = parseInt(process.env.TERMINAL_MONITOR_POLL_MS || "2000", 10);
const CHAIRMAN_NAME = process.env.CHAIRMAN_NAME || "@Chatlead";

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
    const res = await fetch(`${ANT_URL}/api/chat-rooms/${encodeURIComponent(roomName)}/participants`);
    if (!res.ok) return [];
    return (await res.json()) as Participant[];
  } catch {
    return [];
  }
}

// ─── Post approval card ──────────────────────────────────────────────────────

async function postApprovalCard(
  sessionId: string,
  terminalId: string,
  terminalName: string,
  toolType: string,
  detail: string,
  promptId: string,
): Promise<void> {
  await fetch(`${ANT_URL}/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "agent",
      content: `**@Chatlead** — Terminal approval required\n\n**${toolType}**: \`${detail || "(no detail)"}\`\n\nUse the card below to respond.`,
      format: "markdown",
      status: "complete",
      sender_name: CHAIRMAN_NAME,
      sender_type: "agent",
      metadata: {
        type: "terminal_approval",
        terminal_id: terminalId,
        terminal_name: terminalName,
        tool_type: toolType,
        detail,
        prompt_id: promptId,
        status: "pending",
      },
    }),
  });
}

// ─── State ───────────────────────────────────────────────────────────────────

const seenPrompts = new Set<string>();
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
    const participants = await getRoomParticipants(roomName);

    for (const { terminalSessionId, agentName } of participants) {
      const headless = getHeadless(terminalSessionId);
      if (!headless) continue;

      const lines = headless.getScreenLines();
      if (!detectPrompt(lines)) continue;

      const toolType = extractToolType(lines);
      const detail = extractDetail(lines, toolType);
      const promptId = buildPromptId(terminalSessionId, toolType, detail);

      if (seenPrompts.has(promptId)) continue;
      seenPrompts.add(promptId);

      await postApprovalCard(sessionId, terminalSessionId, agentName, toolType, detail, promptId);
      console.log(`[terminal-monitor] Approval card posted for ${agentName}: ${toolType} — ${detail.slice(0, 50)}`);
    }
  } catch (err) {
    console.warn("[terminal-monitor] Poll error:", err instanceof Error ? err.message : err);
  } finally {
    busy = false;
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export function startTerminalMonitor(): void {
  if (intervalHandle) return;
  console.log(`[terminal-monitor] Starting (poll every ${POLL_INTERVAL_MS}ms)`);
  intervalHandle = setInterval(poll, POLL_INTERVAL_MS);
  poll().catch(() => {});
}

export function stopTerminalMonitor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    seenPrompts.clear();
    console.log("[terminal-monitor] Stopped");
  }
}
