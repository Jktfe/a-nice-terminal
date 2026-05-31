/**
 * modelKinds store — model chip list.
 *
 * 2026-05-31 (JWPK): moved from browser-only localStorage to the
 * server-side `default_models` table via /api/default-models. The public
 * surface is unchanged (`enabled`, `init`, `add`, `remove`, `toggle`,
 * `reset`) so the settings UI + per-terminal dropdown need no edits.
 * localStorage is now an OFFLINE CACHE only.
 *
 * `items` exposes the rich rows (provider, runs_where, logo_slug) for chips
 * that want to render a logo — see src/lib/icons/llmLogoCatalogue.ts.
 */
const STORAGE_KEY = 'ant-model-kinds';
const API = '/api/default-models';
// Offline fallback = the canonical server seed (names only).
const DEFAULTS = [
  'kimi',
  'codex',
  'gpt-5',
  'qwen',
  'claude',
  'gemini',
  'gemma',
  'qwen-cloud',
  'gemma4-local',
  'gpt-oss',
  'Ollama-other-cloud',
  'Other-local'
];

export type ModelItem = {
  name: string;
  provider: string | null;
  runs_where: 'cloud' | 'local' | null;
  logo_slug: string | null;
};

class ModelKindsStore {
  enabled = $state<string[]>([...DEFAULTS]);
  items = $state<ModelItem[]>([]);

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
      const data = (await res.json()) as { models?: ModelItem[] };
      if (Array.isArray(data.models)) this.applyRows(data.models);
    } catch {
      /* offline — keep cache */
    }
  }

  private applyRows(rows: ModelItem[]): void {
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
      const data = (await res.json()) as { models?: ModelItem[] };
      if (Array.isArray(data.models)) this.applyRows(data.models);
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

export const modelKinds = new ModelKindsStore();
