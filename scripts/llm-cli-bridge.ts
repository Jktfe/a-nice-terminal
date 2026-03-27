#!/usr/bin/env bun
/**
 * MistralDave Bridge — polls ANT chat, sends relevant messages to llm CLI
 * (Mistral-Small-24B via llm-mlx), posts responses back as "MistralDave".
 *
 * Usage:
 *   THINKING_SESSION=<id> bun run scripts/llm-cli-bridge.ts
 *
 * Env vars (all optional):
 *   ANT_URL           — ANT server base URL (default: http://localhost:6458)
 *   LLM_MODEL         — llm model ID (default: mlx-community/Mistral-Small-24B-Instruct-2501-4bit)
 *   THINKING_SESSION  — Conversation session ID
 *   POLL_INTERVAL_MS  — Polling interval in ms (default: 4000)
 *   DAVE_NAME         — Display name (default: MistralDave)
 */

import { spawn } from "child_process";

const ANT_URL = process.env.ANT_URL || "http://localhost:6458";
const LLM_MODEL = process.env.LLM_MODEL || "mlx-community/Mistral-Small-24B-Instruct-2501-4bit";
const THINKING_SESSION = process.env.THINKING_SESSION || "";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "4000", 10);
const DAVE_NAME = process.env.DAVE_NAME || "MistralDave";

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
let llmBusy = false; // llm-mlx can only handle one request at a time

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

// ─── llm CLI ─────────────────────────────────────────────────────────────────

function queryLlmCli(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fullPrompt = `${SYSTEM_PROMPT}\n\n${prompt}`;
    const child = spawn("llm", ["-m", LLM_MODEL, fullPrompt], {
      env: { ...process.env },
    });

    let output = "";
    let error = "";

    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { error += chunk.toString(); });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`llm exited ${code}: ${error.slice(0, 200)}`));
      } else {
        resolve(output.trim());
      }
    });

    child.on("error", reject);

    // Safety timeout — mlx inference can be slow
    setTimeout(() => {
      child.kill();
      reject(new Error("llm CLI timed out after 120s"));
    }, 120_000);
  });
}

// ─── Message filtering ───────────────────────────────────────────────────────

function shouldRespond(msg: AntMessage): boolean {
  if (msg.role === "system") return false;
  if (msg.sender_name === DAVE_NAME) return false;
  const lower = msg.content.toLowerCase();
  const directMention = lower.includes("mistral") || lower.includes("mistraldave") ||
    lower.includes("@llm") || lower.includes("@mistral");
  const broadcast = lower.includes("everyone") || lower.includes("all of you") ||
    lower.includes("all models");
  return directMention || broadcast;
}

function buildContext(messages: AntMessage[]): string {
  return messages.slice(-6)
    .map((m) => `[${m.sender_name || m.role}]: ${m.content.slice(0, 300)}`)
    .join("\n\n");
}

// ─── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are MistralDave, a member of "The Daves" — a team of AI models collaborating in a shared chat room called MMD-Learning.

You run locally as Mistral-Small-24B-Instruct via llm CLI + llm-mlx on Apple Silicon.

Your role:
- Strong at reasoning, instruction following, and practical coding advice
- Keep responses concise — this is a working team chat
- Always prefix your messages with "[${DAVE_NAME}]"
- Be direct. If you agree with others, add only NEW insights.`;

// ─── Main poll loop ──────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  if (llmBusy) return; // don't queue — skip this tick if already generating

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

    // Process only the first matching message per tick (mlx can't parallelise)
    const toRespond = newMessages.find(shouldRespond);
    if (!toRespond) return;

    console.log(`[bridge] Responding to: "${toRespond.content.slice(0, 80)}..."`);
    llmBusy = true;
    try {
      const context = buildContext(messages);
      const fullPrompt = `Recent conversation:\n${context}\n\n---\n\nRespond to:\n${toRespond.content}`;
      const response = await queryLlmCli(fullPrompt);
      const formatted = response.startsWith(`[${DAVE_NAME}]`) ? response : `[${DAVE_NAME}] ${response}`;
      await postMessage(formatted);
      console.log(`[bridge] Posted (${formatted.length} chars)`);
    } catch (err) {
      console.error(`[bridge] llm CLI error:`, err instanceof Error ? err.message : err);
    } finally {
      llmBusy = false;
    }
  } catch (err) {
    console.warn(`[bridge] Poll error:`, err instanceof Error ? err.message : err);
  }
}

// ─── Startup ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[MistralDave Bridge]`);
  console.log(`  ANT:     ${ANT_URL}`);
  console.log(`  Model:   ${LLM_MODEL}`);
  console.log(`  Session: ${THINKING_SESSION}`);
  console.log(`  Poll:    ${POLL_INTERVAL_MS}ms`);

  const healthRes = await fetch(`${ANT_URL}/api/health`);
  if (!healthRes.ok) { console.error(`[bridge] ANT not healthy`); process.exit(1); }
  console.log(`[bridge] ANT is healthy`);

  // Quick smoke-test of llm CLI (non-fatal — 24B model JIT compile can exceed timeout on cold start)
  console.log(`[bridge] Testing llm CLI (non-fatal)...`);
  try {
    const test = await queryLlmCli("Reply with exactly: OK");
    console.log(`[bridge] llm CLI test passed: "${test.slice(0, 50)}"`);
  } catch (err) {
    console.warn(`[bridge] llm CLI smoke test failed (continuing anyway):`, err instanceof Error ? err.message : err);
  }

  await postMessage(`[${DAVE_NAME}] Online — Mistral-Small-24B via llm-mlx on Apple Silicon. Ready.`);
  console.log(`[bridge] Posted arrival — starting poll loop\n`);

  setInterval(poll, POLL_INTERVAL_MS);
  await poll();
}

main().catch((err) => { console.error("[bridge] Fatal:", err); process.exit(1); });
