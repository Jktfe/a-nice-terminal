#!/usr/bin/env npx tsx
/**
 * LMDave Bridge — polls ThinkingDave chat, sends relevant messages to LM Studio,
 * posts responses back as "[LMDave - GPT-OSS-20B]".
 *
 * Usage:
 *   npx tsx scripts/lmdave-bridge.ts
 *
 * Env vars (all optional):
 *   ANT_URL          — ANT server base URL (default: http://localhost:6458)
 *   LM_STUDIO_URL    — LM Studio API URL (default: http://localhost:1234)
 *   LM_STUDIO_MODEL  — Model ID (default: openai/gpt-oss-20b)
 *   THINKING_SESSION  — ThinkingDave session ID (default: mMkT9iZOybJE)
 *   POLL_INTERVAL_MS  — Polling interval in ms (default: 3000)
 *   DAVE_NAME         — Display name (default: LMDave - GPT-OSS-20B)
 */

const ANT_URL = process.env.ANT_URL || "http://localhost:6458";
const LM_STUDIO_URL = process.env.LM_STUDIO_URL || "http://localhost:1234";
const LM_STUDIO_MODEL = process.env.LM_STUDIO_MODEL || "openai/gpt-oss-20b";
const THINKING_SESSION = process.env.THINKING_SESSION || "mMkT9iZOybJE";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "3000", 10);
const DAVE_NAME = process.env.DAVE_NAME || "LMDave - GPT-OSS-20B";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AntMessage {
  id: string;
  session_id: string;
  role: "human" | "agent" | "system";
  content: string;
  format: string;
  status: string;
  created_at: string;
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
    body: JSON.stringify({
      role: "human",
      content,
      format: "markdown",
      status: "complete",
    }),
  });
  if (!res.ok) {
    console.error(`[bridge] Failed to post message: ${res.status}`);
  }
}

// ─── LM Studio API ──────────────────────────────────────────────────────────

async function queryLmStudio(
  systemPrompt: string,
  conversationContext: string,
  userMessage: string,
): Promise<string> {
  const res = await fetch(`${LM_STUDIO_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LM_STUDIO_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${conversationContext}\n\n---\n\nRespond to the latest message:\n${userMessage}` },
      ],
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LM Studio ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content || "(no response)";
}

// ─── Message filtering ──────────────────────────────────────────────────────

function isDirectedAtLmDave(content: string): boolean {
  const lower = content.toLowerCase();
  return (
    lower.includes("lmdave") ||
    lower.includes("lm dave") ||
    lower.includes("@lmdave") ||
    lower.includes("@lm-dave")
  );
}

function isTeamWideRequest(content: string): boolean {
  const lower = content.toLowerCase();
  return (
    lower.includes("everyone") ||
    lower.includes("team,") ||
    lower.includes("all of you") ||
    lower.includes("requesting from each") ||
    lower.includes("your thoughts") ||
    lower.includes("your opinions")
  );
}

function isFromLmDave(content: string): boolean {
  return content.startsWith(`[${DAVE_NAME}]`);
}

function shouldRespond(msg: AntMessage): boolean {
  // Don't respond to our own messages
  if (isFromLmDave(msg.content)) return false;
  // Don't respond to system messages
  if (msg.role === "system") return false;
  // Respond if directly addressed or team-wide
  return isDirectedAtLmDave(msg.content) || isTeamWideRequest(msg.content);
}

// ─── Context builder ─────────────────────────────────────────────────────────

function buildContext(messages: AntMessage[]): string {
  // Take last 10 messages for context
  const recent = messages.slice(-10);
  return recent
    .map((m) => `${m.content.slice(0, 500)}`)
    .join("\n\n");
}

// ─── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are LMDave, a secondary thinking reviewer in a team of AI agents called "The Daves". You run locally on GPT-OSS-20B via LM Studio.

Your role:
- UX thinking and review — you're great at spotting usability issues
- Secondary review of architecture decisions
- Offering alternative perspectives the team might have missed
- Keeping suggestions practical and implementable

Your team:
- ClaudeDave (Architect) — leads planning and synthesis
- GemDave (Visual expert) — reviews visual/UI aspects and edge cases
- CodexDave (Code generator) — implements once consensus is reached
- LlamaDave (Explainer) — provides architecture explanations using Gemma3 12B
- You (LMDave) — secondary thinking reviewer, UX perspective

Rules:
- Always prefix your messages with "[${DAVE_NAME}]"
- Be concise and direct — this is a working team chat
- Focus on what others might have missed
- If you agree with existing analysis, say so briefly and add only NEW insights
- Use markdown formatting for structure`;

// ─── Main poll loop ──────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  try {
    const messages = await fetchMessages();

    if (messages.length === 0) return;

    // On first poll, just set the cursor — don't respond to old messages
    if (lastSeenAt === null) {
      lastSeenAt = messages[messages.length - 1].created_at;
      for (const m of messages) processedIds.add(m.id);
      console.log(`[bridge] Initial sync — ${messages.length} messages, cursor set to ${lastSeenAt}`);
      return;
    }

    // Find new messages since last seen
    const newMessages = messages.filter(
      (m) => m.created_at > lastSeenAt! && !processedIds.has(m.id),
    );

    if (newMessages.length === 0) return;

    // Update cursor
    lastSeenAt = messages[messages.length - 1].created_at;
    for (const m of newMessages) processedIds.add(m.id);

    // Check each new message
    for (const msg of newMessages) {
      if (!shouldRespond(msg)) {
        console.log(`[bridge] Skipping: "${msg.content.slice(0, 60)}..."`);
        continue;
      }

      console.log(`[bridge] Responding to: "${msg.content.slice(0, 80)}..."`);

      try {
        const context = buildContext(messages);
        const response = await queryLmStudio(SYSTEM_PROMPT, context, msg.content);
        const formatted = response.startsWith(`[${DAVE_NAME}]`)
          ? response
          : `[${DAVE_NAME}] ${response}`;

        await postMessage(formatted);
        console.log(`[bridge] Posted response (${formatted.length} chars)`);
      } catch (err) {
        console.error(`[bridge] LM Studio error:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    // ANT may be temporarily down
    console.warn(`[bridge] Poll error:`, err instanceof Error ? err.message : err);
  }
}

// ─── Startup ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[LMDave Bridge]`);
  console.log(`  ANT:        ${ANT_URL}`);
  console.log(`  LM Studio:  ${LM_STUDIO_URL} (${LM_STUDIO_MODEL})`);
  console.log(`  Session:    ${THINKING_SESSION}`);
  console.log(`  Poll:       ${POLL_INTERVAL_MS}ms`);
  console.log(`  Name:       ${DAVE_NAME}`);
  console.log();

  // Verify connectivity
  try {
    const healthRes = await fetch(`${ANT_URL}/api/health`);
    if (!healthRes.ok) throw new Error(`ANT health check failed: ${healthRes.status}`);
    console.log(`[bridge] ANT is healthy`);
  } catch (err) {
    console.error(`[bridge] Cannot reach ANT at ${ANT_URL}:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }

  try {
    const modelsRes = await fetch(`${LM_STUDIO_URL}/v1/models`);
    if (!modelsRes.ok) throw new Error(`LM Studio health check failed: ${modelsRes.status}`);
    const models = await modelsRes.json() as { data: Array<{ id: string }> };
    console.log(`[bridge] LM Studio models: ${models.data.map((m) => m.id).join(", ")}`);
  } catch (err) {
    console.error(`[bridge] Cannot reach LM Studio at ${LM_STUDIO_URL}:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // Post an arrival message
  await postMessage(`[${DAVE_NAME}] Online and listening. Ready to contribute.`);
  console.log(`[bridge] Posted arrival message — starting poll loop\n`);

  // Start polling
  setInterval(poll, POLL_INTERVAL_MS);
  await poll(); // Run immediately
}

main().catch((err) => {
  console.error("[bridge] Fatal:", err);
  process.exit(1);
});
