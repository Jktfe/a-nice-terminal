#!/usr/bin/env bun
/**
 * OllamaDave Bridge — polls ANT chat, handles @ollama/@ocr/@vision mentions
 * using Ollama's vision/OCR models (granite3.3-vision or glm-ocr).
 *
 * Usage:
 *   THINKING_SESSION=<id> bun run scripts/ollama-bridge.ts
 *
 * How to trigger from chat:
 *   @ollama read ~/Documents/receipt.jpg
 *   @ocr ~/Desktop/scan.png — what does this say?
 *   @vision /path/to/image.jpg describe what you see
 *
 * Env vars (all optional):
 *   ANT_URL             — ANT server base URL (default: http://localhost:6458)
 *   OLLAMA_URL          — Ollama API URL (default: http://localhost:11434)
 *   OLLAMA_VISION_MODEL — Vision model (default: granite3.3-vision:2b)
 *   OLLAMA_OCR_MODEL    — OCR model (default: glm-ocr:latest)
 *   THINKING_SESSION    — Conversation session ID
 *   POLL_INTERVAL_MS    — Polling interval in ms (default: 4000)
 *   DAVE_NAME           — Display name (default: OllamaDave)
 */

import { readFileSync, existsSync } from "fs";
import { resolve, extname } from "path";

const ANT_URL = process.env.ANT_URL || "http://localhost:6458";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || "granite3.3-vision:2b";
const OLLAMA_OCR_MODEL = process.env.OLLAMA_OCR_MODEL || "glm-ocr:latest";
const THINKING_SESSION = process.env.THINKING_SESSION || "";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "4000", 10);
const DAVE_NAME = process.env.DAVE_NAME || "OllamaDave";

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

interface OllamaResponse {
  response: string;
  done: boolean;
}

// ─── State ───────────────────────────────────────────────────────────────────

let lastSeenAt: string | null = null;
const processedIds = new Set<string>();
let busy = false;

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

// ─── File path extraction ─────────────────────────────────────────────────────

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif"]);
const DOC_EXTS = new Set([".pdf", ".txt", ".md", ".csv"]);

function extractFilePath(content: string): string | null {
  // Match paths like ~/foo/bar.jpg, /absolute/path.png, ./relative.jpg
  const match = content.match(/(?:^|\s)(~\/[^\s]+|\/[^\s]+|\.\/[^\s]+)/);
  if (!match) return null;
  const raw = match[1].replace(/^~/, process.env.HOME || "~");
  return resolve(raw);
}

function isOcrRequest(content: string): boolean {
  const lower = content.toLowerCase();
  return lower.includes("@ocr") || lower.includes("ocr") ||
    lower.includes("read this") || lower.includes("what does") ||
    lower.includes("extract text") || lower.includes("transcribe");
}

// ─── Ollama API ───────────────────────────────────────────────────────────────

async function queryOllamaVision(
  imagePath: string,
  prompt: string,
  useOcr = false,
): Promise<string> {
  const ext = extname(imagePath).toLowerCase();
  const isDoc = DOC_EXTS.has(ext);

  // For text files, just read them directly
  if (isDoc && ext !== ".pdf") {
    const text = readFileSync(imagePath, "utf-8").slice(0, 8000);
    return `[${DAVE_NAME}] (read as text file)\n\n\`\`\`\n${text}\n\`\`\``;
  }

  const imageData = readFileSync(imagePath);
  const base64 = imageData.toString("base64");
  const mimeType = ext === ".pdf" ? "image/png" : `image/${ext.slice(1).replace("jpg", "jpeg")}`;

  const model = useOcr ? OLLAMA_OCR_MODEL : OLLAMA_VISION_MODEL;
  console.log(`[bridge] Using model: ${model} for ${imagePath}`);

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: prompt || (useOcr ? "Extract all text from this image verbatim." : "Describe what you see in this image."),
      images: [base64],
      stream: false,
    }),
  });

  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as OllamaResponse;
  return data.response;
}

async function queryOllamaText(prompt: string): Promise<string> {
  // Vision model can handle text-only too, for routing/acknowledgement
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_VISION_MODEL,
      prompt,
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as OllamaResponse;
  return data.response;
}

// ─── Message filtering ────────────────────────────────────────────────────────

function shouldRespond(msg: AntMessage): boolean {
  if (msg.role === "system") return false;
  if (msg.sender_name === DAVE_NAME) return false;
  const lower = msg.content.toLowerCase();
  return lower.includes("@ollama") || lower.includes("@ocr") ||
    lower.includes("@vision") || lower.includes("@ollamadave");
}

// ─── Main poll loop ───────────────────────────────────────────────────────────

async function handleMessage(msg: AntMessage): Promise<void> {
  const filePath = extractFilePath(msg.content);

  if (!filePath) {
    // No file path — acknowledge and explain usage
    const ack = await queryOllamaText(
      `You are OllamaDave, a vision/OCR specialist. Someone said: "${msg.content.slice(0, 200)}"\n\n` +
      `They haven't provided a file path. Briefly explain you need a file path to analyse an image or document. ` +
      `Example: @ollama ~/Desktop/receipt.jpg extract the total amount. Keep it to 2 sentences.`
    ).catch(() =>
      `I need a file path to work with. Example: \`@ollama ~/Desktop/image.jpg describe what you see\``
    );
    await postMessage(`[${DAVE_NAME}] ${ack}`);
    return;
  }

  if (!existsSync(filePath)) {
    await postMessage(`[${DAVE_NAME}] Can't find file: \`${filePath}\``);
    return;
  }

  const ext = extname(filePath).toLowerCase();
  if (!IMAGE_EXTS.has(ext) && !DOC_EXTS.has(ext)) {
    await postMessage(`[${DAVE_NAME}] Unsupported file type: \`${ext}\`. Supported: ${[...IMAGE_EXTS, ...DOC_EXTS].join(", ")}`);
    return;
  }

  // Strip the file path from the prompt to get the actual question
  const promptText = msg.content
    .replace(/(@ollama|@ocr|@vision|@ollamadave)/gi, "")
    .replace(/(?:~\/[^\s]+|\/[^\s]+|\.\/[^\s]+)/, "")
    .trim() || undefined;

  await postMessage(`[${DAVE_NAME}] Reading \`${filePath}\`...`);

  const useOcr = isOcrRequest(msg.content);
  const result = await queryOllamaVision(filePath, promptText ?? "", useOcr);
  const formatted = result.startsWith(`[${DAVE_NAME}]`) ? result : `[${DAVE_NAME}] ${result}`;
  await postMessage(formatted);
  console.log(`[bridge] Posted vision result (${formatted.length} chars)`);
}

async function poll(): Promise<void> {
  if (busy) return;
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

    const toHandle = newMessages.find(shouldRespond);
    if (!toHandle) return;

    console.log(`[bridge] Vision request: "${toHandle.content.slice(0, 80)}"`);
    busy = true;
    try {
      await handleMessage(toHandle);
    } finally {
      busy = false;
    }
  } catch (err) {
    console.warn(`[bridge] Poll error:`, err instanceof Error ? err.message : err);
  }
}

// ─── Startup ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[OllamaDave Bridge]`);
  console.log(`  ANT:     ${ANT_URL}`);
  console.log(`  Ollama:  ${OLLAMA_URL}`);
  console.log(`  Vision:  ${OLLAMA_VISION_MODEL}`);
  console.log(`  OCR:     ${OLLAMA_OCR_MODEL}`);
  console.log(`  Session: ${THINKING_SESSION}`);

  const healthRes = await fetch(`${ANT_URL}/api/health`);
  if (!healthRes.ok) { console.error(`[bridge] ANT not healthy`); process.exit(1); }

  const ollamaRes = await fetch(`${OLLAMA_URL}/api/tags`).catch(() => null);
  if (!ollamaRes?.ok) {
    console.error(`[bridge] Ollama not reachable at ${OLLAMA_URL}`);
    process.exit(1);
  }
  const tags = await ollamaRes.json() as { models: Array<{ name: string }> };
  const modelNames = tags.models.map((m) => m.name);
  console.log(`[bridge] Ollama models available: ${modelNames.join(", ")}`);

  const hasVision = modelNames.some((n) => n.includes("granite") || n.includes("vision"));
  const hasOcr = modelNames.some((n) => n.includes("glm-ocr") || n.includes("ocr"));
  if (!hasVision && !hasOcr) {
    console.warn(`[bridge] Warning: neither vision nor OCR model found in Ollama`);
  }

  await postMessage(
    `[${DAVE_NAME}] Online — vision/OCR specialist.\n` +
    `- Vision: \`${OLLAMA_VISION_MODEL}\`\n` +
    `- OCR: \`${OLLAMA_OCR_MODEL}\`\n\n` +
    `Mention me with \`@ollama\`, \`@ocr\`, or \`@vision\` + a file path.\n` +
    `Example: \`@ollama ~/Desktop/receipt.png extract the total\``
  );
  console.log(`[bridge] Posted arrival — starting poll loop\n`);

  setInterval(poll, POLL_INTERVAL_MS);
  await poll();
}

main().catch((err) => { console.error("[bridge] Fatal:", err); process.exit(1); });
