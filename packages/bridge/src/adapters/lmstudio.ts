import type { ModelAdapter, AntMessage } from "../types.js";

export interface LMStudioAdapterOptions {
  url: string;
  model: string;
  displayName?: string;
  sessions?: string[]; // session IDs to watch, or ["all"]
}

export class LMStudioAdapter implements ModelAdapter {
  readonly name = "lmstudio";
  readonly displayName: string;
  private url: string;
  private model: string;
  private sessions: string[];

  constructor(opts: LMStudioAdapterOptions) {
    this.url = opts.url;
    this.model = opts.model;
    this.displayName = opts.displayName || `LMDave - ${opts.model}`;
    this.sessions = opts.sessions || ["all"];
  }

  async start(): Promise<void> {
    // Verify LM Studio is reachable
    try {
      const res = await globalThis.fetch(`${this.url}/v1/models`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { data: Array<{ id: string }> };
      console.log(`[lmstudio] Models available: ${data.data.map((m) => m.id).join(", ")}`);
    } catch (err) {
      console.warn(`[lmstudio] Cannot reach LM Studio at ${this.url}:`, err instanceof Error ? err.message : err);
      console.warn("[lmstudio] Will retry on each request");
    }
  }

  async stop(): Promise<void> {
    // Nothing to clean up
  }

  shouldRespond(msg: AntMessage): boolean {
    // Don't respond to our own messages
    if (msg.metadata?.source === this.name) return false;
    if (msg.sender_name === this.displayName) return false;

    // Don't respond to system messages
    if (msg.role === "system") return false;

    // Check session filter
    if (!this.sessions.includes("all") && !this.sessions.includes(msg.session_id)) {
      return false;
    }

    const lower = msg.content.toLowerCase();

    // Direct mention
    if (
      lower.includes("lmdave") ||
      lower.includes("lm dave") ||
      lower.includes("@lmdave") ||
      lower.includes("@lm-dave")
    ) return true;

    // Team-wide request
    if (
      lower.includes("everyone") ||
      lower.includes("team,") ||
      lower.includes("all of you") ||
      lower.includes("requesting from each") ||
      lower.includes("your thoughts") ||
      lower.includes("your opinions")
    ) return true;

    return false;
  }

  async generateResponse(messages: AntMessage[], latest: AntMessage): Promise<string> {
    const context = messages
      .slice(-10)
      .map((m) => {
        const name = m.sender_name || m.role;
        return `[${name}] ${m.content.slice(0, 500)}`;
      })
      .join("\n\n");

    const systemPrompt = `You are LMDave, a secondary thinking reviewer in a team of AI agents called "The Daves". You run locally on ${this.model} via LM Studio.

Your role:
- UX thinking and review — you're great at spotting usability issues
- Secondary review of architecture decisions
- Offering alternative perspectives the team might have missed
- Keeping suggestions practical and implementable

Rules:
- Be concise and direct — this is a working team chat
- Focus on what others might have missed
- If you agree with existing analysis, say so briefly and add only NEW insights
- Use markdown formatting for structure`;

    const res = await globalThis.fetch(`${this.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `${context}\n\n---\n\nRespond to the latest message:\n${latest.content}` },
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
}
