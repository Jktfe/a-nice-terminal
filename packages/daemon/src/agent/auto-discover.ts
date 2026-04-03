/**
 * Auto-discovery — probes known localhost ports for OpenAI-compatible APIs
 * and registers available models in the agent_registry.
 *
 * Runs on server startup and can be re-triggered via API.
 */
import db from "../db.js";
import { nanoid } from "nanoid";

interface DiscoveredModel {
  port: number;
  gateway: string;
  model_id: string;
  api_base: string;
}

// Built-in defaults — can be disabled with ANT_DISCOVER_BUILTIN=false
const BUILTIN_PORTS: Array<{ port: number; gateway: string }> = [
  { port: 11434, gateway: "ollama" },
  { port: 11435, gateway: "perspective" },
  { port: 8000,  gateway: "lemonade" },
  { port: 8317,  gateway: "vibecli" },
  { port: 1234,  gateway: "lm-studio" },
  { port: 8080,  gateway: "llamafile" },
];

/**
 * Parse ANT_DISCOVER_PORTS env var.
 * Format: "name:port,name:port" (e.g. "mymodel:9999,another:7777")
 */
function parseCustomPorts(): Array<{ port: number; gateway: string }> {
  const raw = process.env.ANT_DISCOVER_PORTS;
  if (!raw) return [];
  return raw.split(",").map((entry) => {
    const [gateway, portStr] = entry.trim().split(":");
    const port = parseInt(portStr, 10);
    if (!gateway || isNaN(port)) return null;
    return { port, gateway };
  }).filter(Boolean) as Array<{ port: number; gateway: string }>;
}

function getDiscoveryPorts(): Array<{ port: number; gateway: string }> {
  const useBuiltin = process.env.ANT_DISCOVER_BUILTIN !== "false";
  const custom = parseCustomPorts();
  return useBuiltin ? [...BUILTIN_PORTS, ...custom] : custom;
}

async function probePort(port: number, gateway: string): Promise<DiscoveredModel[]> {
  const url = `http://localhost:${port}/v1/models`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return [];

    const data = await res.json() as { data?: Array<{ id: string }> };
    if (!data.data || !Array.isArray(data.data)) return [];

    return data.data.map((m) => ({
      port,
      gateway,
      model_id: m.id,
      api_base: `http://localhost:${port}`,
    }));
  } catch {
    return [];
  }
}

export async function discoverLocalModels(): Promise<DiscoveredModel[]> {
  const ports = getDiscoveryPorts();
  const results = await Promise.all(
    ports.map(({ port, gateway }) => probePort(port, gateway))
  );
  return results.flat();
}

export async function registerDiscoveredModels(): Promise<{ registered: number; models: string[] }> {
  const discovered = await discoverLocalModels();
  const registered: string[] = [];

  const upsert = db.prepare(`
    INSERT INTO agent_registry (id, model_family, display_name, capabilities, preferred_formats, context_window, transport, status, last_seen, gateway, underlying_model, api_base)
    VALUES (?, ?, ?, '["code_generation"]', '["structured"]', NULL, 'rest', 'online', datetime('now'), ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = 'online',
      last_seen = datetime('now'),
      api_base = excluded.api_base,
      underlying_model = excluded.underlying_model
  `);

  for (const model of discovered) {
    const id = `${model.gateway}-${model.model_id}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 50);
    const displayName = `${model.gateway}/${model.model_id}`;

    try {
      // Determine model family from model ID
      let family = model.gateway;
      const lower = model.model_id.toLowerCase();
      if (lower.includes("claude")) family = "claude";
      else if (lower.includes("gemini")) family = "gemini";
      else if (lower.includes("gpt")) family = "gpt";
      else if (lower.includes("qwen")) family = "qwen";
      else if (lower.includes("mistral")) family = "mistral";
      else if (lower.includes("deepseek")) family = "deepseek";
      else if (lower.includes("llama")) family = "llama";

      upsert.run(id, family, displayName, model.gateway, model.model_id, model.api_base);
      registered.push(displayName);
    } catch {
      // Non-fatal
    }
  }

  // Mark models not found as offline
  const allGateways = getDiscoveryPorts().map((p) => p.gateway);
  const discoveredIds = new Set(discovered.map((m) => `${m.gateway}-${m.model_id}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 50)));

  const existing = db.prepare(
    `SELECT id, gateway FROM agent_registry WHERE gateway IN (${allGateways.map(() => "?").join(",")}) AND status = 'online'`
  ).all(...allGateways) as Array<{ id: string; gateway: string }>;

  for (const agent of existing) {
    if (!discoveredIds.has(agent.id)) {
      db.prepare("UPDATE agent_registry SET status = 'offline' WHERE id = ?").run(agent.id);
    }
  }

  console.log(`[auto-discover] Found ${registered.length} model(s): ${registered.join(", ") || "none"}`);
  return { registered: registered.length, models: registered };
}
