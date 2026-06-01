/**
 * agentKinds store — agent-kind chip list.
 *
 * 2026-05-31 (JWPK): moved from browser-only localStorage to the
 * server-side `default_agent_kinds` table via /api/default-agent-kinds.
 * The public surface is unchanged (`enabled`, `init`, `add`, `remove`,
 * `toggle`, `reset`) so TerminalHeader / SimplePageShell / settings need no
 * edits. localStorage is now an OFFLINE CACHE only: it paints last-known
 * chips instantly, then `init()` reconciles against the server.
 *
 * `items` exposes the rich rows (provider, logo_slug) for chips that want
 * to render a logo — see src/lib/icons/llmLogoCatalogue.ts.
 */
const STORAGE_KEY = 'ant-agent-kinds';
const API = '/api/default-agent-kinds';
// Offline fallback = the canonical server seed (names only; the server is
// the source of truth — these mirror defaultCataloguesStore.ts).
const DEFAULTS = ['pi', 'qwen', 'copilot', 'codex', 'claude', 'perspective', 'antigravity'];

export type AgentKindItem = {
  name: string;
  provider: string | null;
  logo_slug: string | null;
};

class AgentKindsStore {
  enabled = $state<string[]>([...DEFAULTS]);
  items = $state<AgentKindItem[]>([]);

  /** Paint from localStorage cache immediately, then reconcile with the
   *  server. Fire-and-forget — callers (onMount) need not await. */
  init(): void {
    this.hydrateFromCache();
    void this.refresh();
  }

  private hydrateFromCache(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        this.enabled = parsed.filter((s) => s.length > 0);
      }
    } catch {
      /* malformed — keep defaults */
    }
  }

  async refresh(): Promise<void> {
    try {
      const res = await fetch(API);
      if (!res.ok) return;
      const data = (await res.json()) as { agentKinds?: AgentKindItem[] };
      if (Array.isArray(data.agentKinds)) this.applyRows(data.agentKinds);
    } catch {
      /* offline — keep cache */
    }
  }

  private applyRows(rows: AgentKindItem[]): void {
    this.items = rows;
    this.enabled = rows.map((r) => r.name);
    this.cache();
  }

  add(label: string): void {
    const trimmed = label.trim();
    if (!trimmed || this.enabled.includes(trimmed)) return;
    this.enabled = [...this.enabled, trimmed]; // optimistic
    this.cache();
    void this.send('POST', API, { name: trimmed });
  }

  remove(label: string): void {
    this.enabled = this.enabled.filter((x) => x !== label); // optimistic
    this.items = this.items.filter((x) => x.name !== label);
    this.cache();
    void this.send('DELETE', `${API}/${encodeURIComponent(label)}`);
  }

  toggle(label: string): void {
    if (this.enabled.includes(label)) this.remove(label);
    else this.add(label);
  }

  reset(): void {
    this.enabled = [...DEFAULTS]; // optimistic
    this.cache();
    void this.send('PUT', API, { names: DEFAULTS });
  }

  private async send(method: string, url: string, body?: unknown): Promise<void> {
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      if (!res.ok) return;
      const data = (await res.json()) as { agentKinds?: AgentKindItem[] };
      if (Array.isArray(data.agentKinds)) this.applyRows(data.agentKinds);
    } catch {
      /* offline — optimistic state already applied + cached */
    }
  }

  private cache(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.enabled));
    } catch {
      /* private mode */
    }
  }
}

export const agentKinds = new AgentKindsStore();
