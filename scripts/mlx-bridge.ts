#!/usr/bin/env bun
/**
 * MLXDave Bridge — polls ANT chat, sends relevant messages to mlx-lm,
 * posts responses back as "MLXDave".
 *
 * Usage:
 *   THINKING_SESSION=<id> bun run scripts/mlx-bridge.ts
 *
 * Requires: mlx-lm server running at MLX_URL (default: http://localhost:8090)
 *   Start with: mlx_lm.server --model mlx-community/Qwen2.5-Coder-32B-Instruct-8bit --port 8090
 *
 * Env vars (all optional):
 *   ANT_URL           — ANT server base URL (default: http://localhost:6458)
 *   MLX_URL           — mlx-lm API URL (default: http://localhost:8090)
 *   MLX_MODEL         — Model ID to request (default: qwen2.5-coder)
 *   THINKING_SESSION  — Conversation session ID
 *   POLL_INTERVAL_MS  — Polling interval in ms (default: 3000)
 *   DAVE_NAME         — Display name (default: MLXDave)
 */

const ANT_URL = process.env.ANT_URL || "http://localhost:6458";
const MLX_URL = process.env.MLX_URL || "http://localhost:8090";
const MLX_MODEL = process.env.MLX_MODEL || "qwen2.5-coder";
const THINKING_SESSION = process.env.THINKING_SESSION || "";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "3000", 10);
const DAVE_NAME = process.env.DAVE_NAME || "MLXDave";

if (!THINKING_SESSION) {
  console.error("[bridge] THINKING_SESSION is required");
  process.exit(1);
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface AntMessage {
  id: string;
  role: "human" | "agent" | "system";
  content: string;
  created_at: string;
  sender_name?: string;
}

// ─── State ───────────────────────────────────────────────────────────────────

let lastSeenAt: string | null = null;
const processedIds = new Set<string>();

// ─── ANT API ─────────────────────────────────────────────────────────────────

async function fetchMessages(): Promise<AntMessage[]> {
  const res = await fetch(`${ANT_URL}/api/sessions/${THINKING_SESSION}/messages`);
  if (!res.ok) throw new Error(`ANT ${res.status}: ${await res.text()}`);
  return res.json() as Promise<AntMessage[]>;
}

async function postMessage(content: string): Promise<void> {
  const res = await fetch(`${ANT_URL}/api/sessions/${THINKING_SESSION}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "agent", content, format: "markdown", status: "complete",
      sender_name: DAVE_NAME, sender_type: "agent" }),
  });
  if (!res.ok) console.error(`[bridge] Failed to post: ${res.status}`);
}

// ─── mlx-lm API ──────────────────────────────────────────────────────────────

async function queryMlx(context: string, userMessage: string): Promise<string> {
  const res = await fetch(`${MLX_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MLX_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `${context}\n\n---\n\nRespond to the latest message:\n${userMessage}` },
      ],
      temperature: 0.7,
      max_tokens: 1024,
    }),
  });
  if (!res.ok) throw new Error(`mlx-lm ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content || "(no response)";
}

// ─── Message filtering ───────────────────────────────────────────────────────

function shouldRespond(msg: AntMessage): boolean {
  if (msg.role === "system") return false;
  if (msg.sender_name === DAVE_NAME) return false;
  const lower = msg.content.toLowerCase();
  const directMention = lower.includes("mlxdave") || lower.includes("@mlx") ||
    lower.includes("@qwen") || lower.includes("qwendave");
  const broadcast = lower.includes("everyone") || lower.includes("all of you") ||
    lower.includes("all models");
  return directMention || broadcast;
}

function buildContext(messages: AntMessage[]): string {
  return messages.slice(-8)
    .map((m) => `[${m.sender_name || m.role}]: ${m.content.slice(0, 400)}`)
    .join("\n\n");
}

// ─── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are MLXDave, a member of "The Daves" — a team of AI models collaborating in a shared chat room called MMD-Learning.

You run locally as Qwen3.5-27B (Claude 4.6 Opus distilled) via mlx-lm on Apple Silicon (port 8090).

Your role:
- Specialist in code, architecture, and technical reasoning
- Keep responses concise — this is a working team chat
- Always prefix your messages with "[${DAVE_NAME}]"
- Be direct. Add only NEW insights beyond what's already been said.`;

// ─── Main poll loop ──────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  try {
    const messages = await fetchMessages();
    if (messages.length === 0) return;

    if (lastSeenAt === null) {
      lastSeenAt = messages[messages.length - 1].created_at;
      for (const m of messages) processedIds.add(m.id);
      console.log(`[bridge] Initial sync — ${messages.length} messages, cursor set`);
      return;
    }

    const newMessages = messages.filter(
      (m) => m.created_at > lastSeenAt! && !processedIds.has(m.id),
    );
    if (newMessages.length === 0) return;

    lastSeenAt = messages[messages.length - 1].created_at;
    for (const m of newMessages) processedIds.add(m.id);

    for (const msg of newMessages) {
      if (!shouldRespond(msg)) continue;
      console.log(`[bridge] Responding to: "${msg.content.slice(0, 80)}..."`);
      try {
        const context = buildContext(messages);
        const response = await queryMlx(context, msg.content);
        const formatted = response.startsWith(`[${DAVE_NAME}]`) ? response : `[${DAVE_NAME}] ${response}`;
        await postMessage(formatted);
        console.log(`[bridge] Posted (${formatted.length} chars)`);
      } catch (err) {
        console.error(`[bridge] mlx-lm error:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.warn(`[bridge] Poll error:`, err instanceof Error ? err.message : err);
  }
}

// ─── Startup ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[MLXDave Bridge]`);
  console.log(`  ANT:     ${ANT_URL}`);
  console.log(`  mlx-lm:  ${MLX_URL} (${MLX_MODEL})`);
  console.log(`  Session: ${THINKING_SESSION}`);
  console.log(`  Poll:    ${POLL_INTERVAL_MS}ms`);

  const healthRes = await fetch(`${ANT_URL}/api/health`);
  if (!healthRes.ok) { console.error(`[bridge] ANT not healthy`); process.exit(1); }

  const modelsRes = await fetch(`${MLX_URL}/v1/models`).catch(() => null);
  if (!modelsRes?.ok) {
    console.error(`[bridge] mlx-lm not reachable at ${MLX_URL}`);
    console.error(`[bridge] Start it with: mlx_lm.server --model wbkou/Qwen3.5-27B-Claude-4.6-Opus-Distilled-8bit-MLX --port 8090`);
    process.exit(1);
  }
  console.log(`[bridge] mlx-lm is healthy`);

  await postMessage(`[${DAVE_NAME}] Online — Qwen3.5-27B (Claude 4.6 Opus distilled) via mlx-lm on Apple Silicon. Ready.`);
  console.log(`[bridge] Posted arrival — starting poll loop\n`);

  setInterval(poll, POLL_INTERVAL_MS);
  await poll();
}

main().catch((err) => { console.error("[bridge] Fatal:", err); process.exit(1); });
