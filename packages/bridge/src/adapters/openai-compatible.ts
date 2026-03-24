/**
 * Generic OpenAI-compatible adapter factory.
 *
 * Connects to any localhost endpoint that speaks the OpenAI /v1/chat/completions
 * API. Replaces the need for separate adapters per tool — one adapter handles
 * Ollama, Lemonade, Perspective, vibeCLI, llamafile, and LM Studio.
 */
import type { ModelAdapter, AntMessage } from "../types.js";

export interface OpenAICompatibleAdapterOptions {
  name: string;
  displayName: string;
  url: string;           // e.g. "http://localhost:11434"
  model?: string;        // e.g. "mistral:7b" — if omitted, uses first available
  triggerWords: string[]; // e.g. ["@ollama", "@mistral"]
  sessions?: string[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export class OpenAICompatibleAdapter implements ModelAdapter {
  readonly name: string;
  readonly displayName: string;
  private url: string;
  private model: string | undefined;
  private resolvedModel: string | undefined;
  private triggerWords: string[];
  private sessions: string[];
  private systemPrompt: string;
  private maxTokens: number;
  private temperature: number;

  constructor(opts: OpenAICompatibleAdapterOptions) {
    this.name = opts.name;
    this.displayName = opts.displayName;
    this.url = opts.url.replace(/\/$/, "");
    this.model = opts.model;
    this.triggerWords = opts.triggerWords.map((w) => w.toLowerCase());
    this.sessions = opts.sessions || ["all"];
    this.systemPrompt = opts.systemPrompt || `You are ${opts.displayName}, an AI assistant in a terminal management platform called ANT. Be concise and helpful.`;
    this.maxTokens = opts.maxTokens || 2048;
    this.temperature = opts.temperature ?? 0.7;
  }

  async start(): Promise<void> {
    try {
      const res = await globalThis.fetch(`${this.url}/v1/models`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { data: Array<{ id: string }> };
      const models = data.data.map((m) => m.id);
      console.log(`[${this.name}] Available models: ${models.join(", ")}`);

      // Auto-resolve model if not specified
      if (!this.model && models.length > 0) {
        this.resolvedModel = models[0];
        console.log(`[${this.name}] Auto-selected model: ${this.resolvedModel}`);
      } else {
        this.resolvedModel = this.model;
      }
    } catch (err) {
      console.warn(`[${this.name}] Cannot reach ${this.url}:`, err instanceof Error ? err.message : err);
    }
  }

  async stop(): Promise<void> {}

  shouldRespond(msg: AntMessage): boolean {
    if (msg.metadata?.source === this.name) return false;
    if (msg.sender_name === this.displayName) return false;
    if (msg.role === "system") return false;

    if (!this.sessions.includes("all") && !this.sessions.includes(msg.session_id)) {
      return false;
    }

    const lower = msg.content.toLowerCase();
    return this.triggerWords.some((w) => lower.includes(w));
  }

  async generateResponse(messages: AntMessage[], latest: AntMessage): Promise<string> {
    const model = this.resolvedModel || this.model;
    if (!model) throw new Error(`[${this.name}] No model available`);

    const context = messages
      .slice(-10)
      .map((m) => {
        const name = m.sender_name || m.role;
        return `[${name}] ${m.content.slice(0, 500)}`;
      })
      .join("\n\n");

    const res = await globalThis.fetch(`${this.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: this.systemPrompt },
          { role: "user", content: `${context}\n\n---\n\nRespond to:\n${latest.content}` },
        ],
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${this.name} ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content || "(no response)";
  }
}

/**
 * Parse BRIDGE_OPENAI_ENDPOINTS env var into adapter configs.
 * Format: "name:port,name:port,..." (e.g. "perspective:11435,lemonade:8000,ollama:11434")
 */
export function parseOpenAIEndpoints(envVar?: string): OpenAICompatibleAdapterOptions[] {
  if (!envVar) return [];
  return envVar.split(",").map((entry) => {
    const [name, port] = entry.trim().split(":");
    if (!name || !port) return null;
    return {
      name,
      displayName: name.charAt(0).toUpperCase() + name.slice(1),
      url: `http://localhost:${port}`,
      triggerWords: [`@${name}`],
    } as OpenAICompatibleAdapterOptions;
  }).filter(Boolean) as OpenAICompatibleAdapterOptions[];
}
