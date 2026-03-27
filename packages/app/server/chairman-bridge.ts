/**
 * Embedded Chairman Bridge — runs inside the ANT server process.
 * Polls the configured session for @chatlead mentions and routes tasks
 * to the right agent via LM Studio (OpenAI-compatible API).
 *
 * Auto-starts when chairman_enabled is "1" in server_state.
 * Checks the toggle on every poll cycle so it can be switched on/off
 * from the UI without restarting the server.
 */

import db from "./db.js";
import { startTerminalMonitor, stopTerminalMonitor } from "./terminal-monitor.js";
import { startMessageBridge, stopMessageBridge } from "./message-bridge.js";
import { startTaskWatchdog, stopTaskWatchdog } from "./task-watchdog.js";

const ANT_URL = `http://localhost:${process.env.ANT_PORT || "6458"}`;
const LM_STUDIO_URL = process.env.LM_STUDIO_URL || "http://localhost:1234";
const POLL_INTERVAL_MS = parseInt(process.env.CHAIRMAN_POLL_MS || "4000", 10);
const CHAIRMAN_NAME = process.env.CHAIRMAN_NAME || "@Chatlead";
const BUSY_THRESHOLD_MS = parseInt(process.env.CHAIRMAN_BUSY_THRESHOLD_MS || "90000", 10);

// ─── Types ───────────────────────────────────────────────────────────────────

interface AntMessage {
  id: string;
  role: "human" | "agent" | "system";
  content: string;
  created_at: string;
  sender_name?: string;
  metadata?: any;
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

const KNOWN_AGENTS = [
  { name: "@ANTClaude", type: "antclaude", domain: "ANT" },
  { name: "@ANTGem", type: "antgem", domain: "ANT" },
  { name: "@MMDClaude", type: "mmdclaude", domain: "MMD" },
  { name: "@MMDGem", type: "mmdgem", domain: "MMD" },
] as const;

const SYSTEM_PROMPT = `You are @Chatlead, the Chairman and task router in the MMD-and-ANT multi-agent chat.

AGENTS:
- @ANTClaude — ANT codebase work (TypeScript, server, UI, bridges, infrastructure)
- @ANTGem    — ANT work, UI-focused; use when @ANTClaude is busy
- @MMDClaude — MMD project work (content, documents, MMD-specific features)
- @MMDGem    — MMD work; use when @MMDClaude is busy

ROUTING RULES:
1. Match the domain: ANT tasks → ANT agents; MMD tasks → MMD agents
2. If a domain is ambiguous, ask one clarifying question before routing
3. Always prefer available agents; if both are busy, say "holding — both [domain] agents busy"
4. Never pick more than 2 agents for a single request unless clearly separate tasks

RESPOND ONLY WITH JSON (no prose before or after):
{
  "action": "assign" | "hold" | "clarify",
  "reason": "<one sentence>",
  "assignments": [
    { "task_id": "T001", "assigned_to": "@ANTClaude", "assigned_type": "antclaude", "branch": "" }
  ],
  "hold_message": "<only present when action is hold>",
  "question": "<only present when action is clarify>"
}

task_id: generate a short slug like T001, T002 etc.
If action is "hold" or "clarify", set assignments to [].`;

// ─── State ───────────────────────────────────────────────────────────────────

let lastSeenAt: string | null = null;
const processedIds = new Set<string>();
let busy = false;
let taskCounter = 0;
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

// ─── Agent availability ──────────────────────────────────────────────────────

function getAgentAvailability(messages: AntMessage[]): Record<string, boolean> {
  const now = Date.now();
  const available: Record<string, boolean> = {};
  for (const agent of KNOWN_AGENTS) {
    const lastMsg = [...messages]
      .reverse()
      .find((m) => m.sender_name?.toLowerCase() === agent.name.toLowerCase());
    available[agent.name] = !lastMsg || now - new Date(lastMsg.created_at).getTime() > BUSY_THRESHOLD_MS;
  }
  return available;
}

function buildContext(messages: AntMessage[], availability: Record<string, boolean>): string {
  const recentLines = messages
    .slice(-15)
    .map((m) => `[${m.sender_name || m.role}]: ${m.content.slice(0, 300)}`)
    .join("\n");
  const availLines = KNOWN_AGENTS.map(
    (a) => `- ${a.name} (${a.domain}): ${availability[a.name] ? "AVAILABLE" : "BUSY"}`
  ).join("\n");
  return `=== Agent Availability ===\n${availLines}\n\n=== Recent Chat ===\n${recentLines}`;
}

// ─── LM Studio API ──────────────────────────────────────────────────────────

async function queryLmStudio(userContent: string, context: string): Promise<string> {
  const model = getModel();
  const res = await fetch(`${LM_STUDIO_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `${context}\n\n=== New Request ===\n${userContent}` },
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

// ─── Message filtering ──────────────────────────────────────────────────────

function shouldRespond(msg: AntMessage): boolean {
  if (msg.role === "system") return false;
  if (msg.sender_name === CHAIRMAN_NAME) return false;
  const lower = msg.content.toLowerCase();
  return (
    lower.includes("@chatlead") ||
    lower.includes("chairman") ||
    lower.includes("route this") ||
    lower.includes("assign this") ||
    lower.includes("who should") ||
    lower.includes("delegate")
  );
}

// ─── Handle message ─────────────────────────────────────────────────────────

async function handleMessage(sessionId: string, msg: AntMessage, allMessages: AntMessage[]): Promise<void> {
  const availability = getAgentAvailability(allMessages);
  const context = buildContext(allMessages, availability);

  console.log(`[chairman] Routing request: "${msg.content.slice(0, 80)}"`);
  const raw = await queryLmStudio(msg.content, context);
  const decision = parseDecision(raw);

  if (!decision) {
    console.warn(`[chairman] Could not parse LLM response, posting raw`);
    await postMessage(sessionId, `[${CHAIRMAN_NAME}] ${raw}`);
    return;
  }

  switch (decision.action) {
    case "assign": {
      const assignments = decision.assignments.map((a) => ({
        ...a,
        task_id: a.task_id || `T${String(++taskCounter).padStart(3, "0")}`,
      }));
      const summary = assignments.map((a) => `**${a.task_id}** → ${a.assigned_to}`).join("\n");
      await postMessage(sessionId, `[${CHAIRMAN_NAME}] ${decision.reason}\n\n${summary}`, {
        type: "assignment",
        assignments,
      });
      console.log(`[chairman] Assigned: ${assignments.map((a) => `${a.task_id}→${a.assigned_to}`).join(", ")}`);
      break;
    }
    case "hold":
      await postMessage(sessionId, `[${CHAIRMAN_NAME}] ${decision.hold_message || "Holding — agents busy."}`);
      console.log(`[chairman] Holding: ${decision.reason}`);
      break;
    case "clarify":
      await postMessage(sessionId, `[${CHAIRMAN_NAME}] ${decision.question || "Can you clarify the task?"}`);
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
    const messages = await fetchMessages(sessionId);
    if (messages.length === 0) return;

    // Announce on first enabled poll
    if (!hasAnnounced) {
      hasAnnounced = true;
      await postMessage(
        sessionId,
        `[${CHAIRMAN_NAME}] Online — task router active.\n` +
          `- Model: \`${getModel()}\`\n` +
          `- Mention \`@chatlead\` or say \`assign this\` / \`route this\` to trigger routing.`
      );
    }

    if (lastSeenAt === null) {
      lastSeenAt = messages[messages.length - 1].created_at;
      for (const m of messages) processedIds.add(m.id);
      console.log(`[chairman] Initial sync — ${messages.length} messages`);
      return;
    }

    const newMessages = messages.filter(
      (m) => m.created_at > lastSeenAt! && !processedIds.has(m.id)
    );
    if (newMessages.length === 0) return;

    lastSeenAt = messages[messages.length - 1].created_at;
    for (const m of newMessages) processedIds.add(m.id);

    const toHandle = newMessages.find(shouldRespond);
    if (!toHandle) return;

    busy = true;
    try {
      await handleMessage(sessionId, toHandle, messages);
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
