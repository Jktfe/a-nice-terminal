#!/usr/bin/env bun
/**
 * Chairman Bridge — @Chatlead task router for ANT multi-agent chat.
 * Routes incoming tasks to the right AI agent based on domain (ANT vs MMD)
 * and agent availability. Powered by a local LLM via LM Studio.
 *
 * Usage:
 *   CHAIRMAN_SESSION=<id> bun run scripts/chairman-bridge.ts
 *
 * Env vars (all optional except CHAIRMAN_SESSION):
 *   ANT_URL            — ANT server base URL (default: http://localhost:6458)
 *   LM_STUDIO_URL      — LM Studio API URL (default: http://localhost:1234)
 *   CHAIRMAN_MODEL     — Model to use (default: openai/gpt-oss-20b)
 *   CHAIRMAN_SESSION   — Conversation session ID (required)
 *   POLL_INTERVAL_MS   — Polling interval in ms (default: 4000)
 *   CHAIRMAN_NAME      — Display name (default: @Chatlead)
 */

const ANT_URL = process.env.ANT_URL || "http://localhost:6458";
const LM_STUDIO_URL = process.env.LM_STUDIO_URL || "http://localhost:1234";
let currentModel = process.env.CHAIRMAN_MODEL || "openai/gpt-oss-20b";
const CHAIRMAN_SESSION = process.env.CHAIRMAN_SESSION || "";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "4000", 10);
const CHAIRMAN_NAME = process.env.CHAIRMAN_NAME || "@Chatlead";
const BUSY_THRESHOLD_MS = parseInt(process.env.CHAIRMAN_BUSY_THRESHOLD_MS || "90000", 10);

if (!CHAIRMAN_SESSION) {
  console.error("[chairman] CHAIRMAN_SESSION is required");
  process.exit(1);
}

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

// ─── ANT API ─────────────────────────────────────────────────────────────────

async function fetchMessages(): Promise<AntMessage[]> {
  const res = await fetch(`${ANT_URL}/api/sessions/${CHAIRMAN_SESSION}/messages`);
  if (!res.ok) throw new Error(`ANT ${res.status}: ${await res.text()}`);
  return res.json() as Promise<AntMessage[]>;
}

async function postMessage(content: string, metadata?: any): Promise<void> {
  const body: any = {
    role: "agent",
    content,
    format: "markdown",
    status: "complete",
    sender_name: CHAIRMAN_NAME,
    sender_type: "agent",
  };
  if (metadata) body.metadata = metadata;

  const res = await fetch(`${ANT_URL}/api/sessions/${CHAIRMAN_SESSION}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error(`[chairman] Failed to post: ${res.status}`);
}

// ─── Toggle check ────────────────────────────────────────────────────────────

async function isEnabled(): Promise<boolean> {
  try {
    const res = await fetch(`${ANT_URL}/api/chairman/status`);
    if (!res.ok) return false;
    const data = (await res.json()) as { enabled: boolean; model?: string };
    if (data.model && data.model !== currentModel) {
      currentModel = data.model;
      console.log(`[chairman] Model updated to: ${currentModel}`);
    }
    return data.enabled;
  } catch {
    return false;
  }
}

// ─── Agent availability ──────────────────────────────────────────────────────

function getAgentAvailability(messages: AntMessage[]): Record<string, boolean> {
  const now = Date.now();
  const available: Record<string, boolean> = {};

  for (const agent of KNOWN_AGENTS) {
    const lastMsg = [...messages]
      .reverse()
      .find((m) => m.sender_name?.toLowerCase() === agent.name.toLowerCase());

    if (!lastMsg) {
      available[agent.name] = true;
    } else {
      const lastMsgMs = new Date(lastMsg.created_at).getTime();
      available[agent.name] = now - lastMsgMs > BUSY_THRESHOLD_MS;
    }
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
  const res = await fetch(`${LM_STUDIO_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: currentModel,
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
    const cleaned = raw
      .replace(/^```(?:json)?\n?/m, "")
      .replace(/\n?```$/m, "")
      .trim();
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

async function handleMessage(msg: AntMessage, allMessages: AntMessage[]): Promise<void> {
  const enabled = await isEnabled();
  if (!enabled) {
    console.log(`[chairman] Disabled — skipping message from ${msg.sender_name}`);
    return;
  }

  const availability = getAgentAvailability(allMessages);
  const context = buildContext(allMessages, availability);

  console.log(`[chairman] Routing request: "${msg.content.slice(0, 80)}"`);
  const raw = await queryLmStudio(msg.content, context);
  const decision = parseDecision(raw);

  if (!decision) {
    console.warn(`[chairman] Could not parse LLM response, posting raw`);
    await postMessage(`[${CHAIRMAN_NAME}] ${raw}`);
    return;
  }

  switch (decision.action) {
    case "assign": {
      const assignments = decision.assignments.map((a) => ({
        ...a,
        task_id: a.task_id || `T${String(++taskCounter).padStart(3, "0")}`,
      }));
      const summary = assignments
        .map((a) => `**${a.task_id}** → ${a.assigned_to}`)
        .join("\n");
      await postMessage(
        `[${CHAIRMAN_NAME}] ${decision.reason}\n\n${summary}`,
        { type: "assignment", assignments }
      );
      console.log(`[chairman] Assigned: ${assignments.map((a) => `${a.task_id}→${a.assigned_to}`).join(", ")}`);
      break;
    }
    case "hold": {
      await postMessage(`[${CHAIRMAN_NAME}] ${decision.hold_message || "Holding — agents busy."}`);
      console.log(`[chairman] Holding: ${decision.reason}`);
      break;
    }
    case "clarify": {
      await postMessage(`[${CHAIRMAN_NAME}] ${decision.question || "Can you clarify the task?"}`);
      console.log(`[chairman] Clarifying: ${decision.reason}`);
      break;
    }
  }
}

// ─── Main poll loop ─────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  if (busy) return;
  try {
    const messages = await fetchMessages();
    if (messages.length === 0) return;

    if (lastSeenAt === null) {
      lastSeenAt = messages[messages.length - 1].created_at;
      for (const m of messages) processedIds.add(m.id);
      console.log(`[chairman] Initial sync — ${messages.length} messages, cursor set`);
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
      await handleMessage(toHandle, messages);
    } finally {
      busy = false;
    }
  } catch (err) {
    console.warn(`[chairman] Poll error:`, err instanceof Error ? err.message : err);
  }
}

// ─── Startup ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[Chairman Bridge]`);
  console.log(`  ANT:       ${ANT_URL}`);
  console.log(`  LM Studio: ${LM_STUDIO_URL}`);
  console.log(`  Model:     ${currentModel}`);
  console.log(`  Session:   ${CHAIRMAN_SESSION}`);
  console.log(`  Name:      ${CHAIRMAN_NAME}`);

  const healthRes = await fetch(`${ANT_URL}/api/health`);
  if (!healthRes.ok) {
    console.error(`[chairman] ANT not healthy`);
    process.exit(1);
  }

  const lmsRes = await fetch(`${LM_STUDIO_URL}/v1/models`).catch(() => null);
  if (!lmsRes?.ok) {
    console.warn(`[chairman] LM Studio not reachable at ${LM_STUDIO_URL} — will retry on first request`);
  } else {
    const data = (await lmsRes.json()) as { data: Array<{ id: string }> };
    const modelNames = data.data.map((m) => m.id);
    console.log(`[chairman] LM Studio models: ${modelNames.join(", ")}`);
  }

  const enabled = await isEnabled();
  if (!enabled) {
    console.log(`[chairman] Chairman mode is OFF — standing by (enable via ANT UI)`);
  } else {
    await postMessage(
      `[${CHAIRMAN_NAME}] Online — task router active.\n` +
        `- Model: \`${currentModel}\`\n` +
        `- Mention \`@chatlead\` or say \`assign this\` / \`route this\` to trigger routing.`
    );
  }

  console.log(`[chairman] Starting poll loop (${POLL_INTERVAL_MS}ms)\n`);
  setInterval(poll, POLL_INTERVAL_MS);
  await poll();
}

main().catch((err) => {
  console.error("[chairman] Fatal:", err);
  process.exit(1);
});
