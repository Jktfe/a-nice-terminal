#!/usr/bin/env bun
/**
 * LlamafileDave Bridge — polls ANT chat, sends relevant messages to llamafile,
 * posts responses back as "LlamafileDave".
 *
 * Usage:
 *   THINKING_SESSION=<id> bun run scripts/llamafile-bridge.ts
 *
 * Env vars (all optional):
 *   ANT_URL           — ANT server base URL (default: http://localhost:6458)
 *   LLAMAFILE_URL     — llamafile API URL (default: http://localhost:8080)
 *   LLAMAFILE_MODEL   — Model ID (default: gemma3)
 *   THINKING_SESSION  — Conversation session ID
 *   POLL_INTERVAL_MS  — Polling interval in ms (default: 3000)
 *   DAVE_NAME         — Display name (default: LlamafileDave)
 */

const ANT_URL = process.env.ANT_URL || "http://localhost:6458";
const LLAMAFILE_URL = process.env.LLAMAFILE_URL || "http://localhost:8080";
const LLAMAFILE_MODEL = process.env.LLAMAFILE_MODEL || "gemma3";
const THINKING_SESSION = process.env.THINKING_SESSION || "";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "3000", 10);
const DAVE_NAME = process.env.DAVE_NAME || "LlamafileDave";

if (!THINKING_SESSION) {
  console.error("[bridge] THINKING_SESSION is required");
  process.exit(1);
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface AntMessage {
  id: string;
  session_id: string;
  role: "human" | "agent" | "system";
  content: string;
  format: string;
  status: string;
  created_at: string;
  sender_name?: string;
}

// ─── State ───────────────────────────────────────────────────────────────────

let lastSeenAt: string | null = null;
const processedIds = new Set<string>();

// ─── ANT API ─────────────────────────────────────────────────────────────────

async function fetchMessages(since?: string): Promise<AntMessage[]> {
  const qs = since ? `?since=${encodeURIComponent(since)}` : "";
  const res = await fetch(`${ANT_URL}/api/sessions/${THINKING_SESSION}/messages${qs}`);
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

// ─── llamafile API ───────────────────────────────────────────────────────────

async function queryLlamafile(context: string, userMessage: string): Promise<string> {
  const res = await fetch(`${LLAMAFILE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LLAMAFILE_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `${context}\n\n---\n\nRespond to the latest message:\n${userMessage}` },
      ],
      temperature: 0.7,
      max_tokens: 1024,
    }),
  });
  if (!res.ok) throw new Error(`llamafile ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content || "(no response)";
}

// ─── Message filtering ───────────────────────────────────────────────────────

function shouldRespond(msg: AntMessage): boolean {
  if (msg.role === "system") return false;
  if (msg.sender_name === DAVE_NAME) return false;
  const lower = msg.content.toLowerCase();
  const directMention = lower.includes("llamafile") || lower.includes("llamafiledave") ||
    lower.includes("@gemma") || lower.includes("@llama");
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

const SYSTEM_PROMPT = `You are LlamafileDave, a member of "The Daves" — a team of AI models collaborating in a shared chat room called MMD-Learning.

You run locally as Gemma 3 12B via llamafile on Apple Metal GPU.

Your role:
- Contribute thoughtful perspectives on technical questions
- Strong at reasoning, code review, and architecture discussions
- Keep responses concise — this is a working team chat, not an essay

Rules:
- Always prefix your messages with "[${DAVE_NAME}]"
- Be direct and helpful
- If you agree with others, say so briefly and add only NEW insights
- Use markdown for structure when helpful`;

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
        const response = await queryLlamafile(context, msg.content);
        const formatted = response.startsWith(`[${DAVE_NAME}]`) ? response : `[${DAVE_NAME}] ${response}`;
        await postMessage(formatted);
        console.log(`[bridge] Posted (${formatted.length} chars)`);
      } catch (err) {
        console.error(`[bridge] llamafile error:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.warn(`[bridge] Poll error:`, err instanceof Error ? err.message : err);
  }
}

// ─── Startup ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[LlamafileDave Bridge]`);
  console.log(`  ANT:       ${ANT_URL}`);
  console.log(`  llamafile: ${LLAMAFILE_URL} (${LLAMAFILE_MODEL})`);
  console.log(`  Session:   ${THINKING_SESSION}`);
  console.log(`  Poll:      ${POLL_INTERVAL_MS}ms`);

  const healthRes = await fetch(`${ANT_URL}/api/health`);
  if (!healthRes.ok) { console.error(`[bridge] ANT not healthy`); process.exit(1); }

  // Check llamafile is up
  const modelsRes = await fetch(`${LLAMAFILE_URL}/v1/models`).catch(() => null);
  if (!modelsRes?.ok) { console.error(`[bridge] llamafile not reachable at ${LLAMAFILE_URL}`); process.exit(1); }
  console.log(`[bridge] llamafile is healthy`);

  await postMessage(`[${DAVE_NAME}] Online — Gemma 3 12B on Metal GPU, ready to contribute.`);
  console.log(`[bridge] Posted arrival — starting poll loop\n`);

  setInterval(poll, POLL_INTERVAL_MS);
  await poll();
}

main().catch((err) => { console.error("[bridge] Fatal:", err); process.exit(1); });
