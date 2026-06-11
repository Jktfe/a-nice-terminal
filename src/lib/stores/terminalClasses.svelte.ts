/**
 * terminalClasses store — the editable account-type + model-family pick-lists
 * for the terminals v3 desk directory (JWPK msg_mc8rejzopg 2026-06-11).
 *
 * Server-persisted via /api/terminal-classes?cat=… (same architecture as
 * agentKinds/modelKinds). localStorage is an offline paint cache only. Two
 * independent lists exposed as `accountTypes` and `modelFamilies`.
 */
const API = '/api/terminal-classes';
const CACHE_KEY = 'ant-terminal-classes';

const ACCOUNT_DEFAULTS = [
  'Claude Subscription', 'Codex Subscription', 'Ollama Subscription',
  'Gemini Subscription', 'Qwen Subscription', 'Quiver Subscription',
  'Copilot Subscription', 'Local', 'External'
];
const FAMILY_DEFAULTS = [
  'Claude', 'Codex', 'MiniMax', 'Kimi', 'Qwen', 'glm', 'Gemini', 'Quiver',
  'Gemma', 'GPT-OSS', 'AFM', 'Other-Ollama-Cloud', 'Other-Cloud', 'Other-Local'
];

type Cat = 'account_types' | 'model_families';

class TerminalClassesStore {
  accountTypes = $state<string[]>([...ACCOUNT_DEFAULTS]);
  modelFamilies = $state<string[]>([...FAMILY_DEFAULTS]);

  init(): void {
    this.hydrateFromCache();
    void this.refresh('account_types');
    void this.refresh('model_families');
  }

  private hydrateFromCache(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { accountTypes?: string[]; modelFamilies?: string[] };
      if (Array.isArray(parsed.accountTypes)) this.accountTypes = parsed.accountTypes;
      if (Array.isArray(parsed.modelFamilies)) this.modelFamilies = parsed.modelFamilies;
    } catch { /* corrupt cache — ignore, server reconciles */ }
  }

  private persistCache(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        accountTypes: this.accountTypes, modelFamilies: this.modelFamilies
      }));
    } catch { /* quota / disabled — non-fatal */ }
  }

  private assign(cat: Cat, names: string[]): void {
    if (cat === 'account_types') this.accountTypes = names;
    else this.modelFamilies = names;
    this.persistCache();
  }

  async refresh(cat: Cat): Promise<void> {
    try {
      const res = await fetch(`${API}?cat=${cat}`, { headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const body = (await res.json()) as { names?: string[] };
      if (Array.isArray(body.names)) this.assign(cat, body.names);
    } catch { /* offline — cache stands */ }
  }

  async add(cat: Cat, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const res = await fetch(`${API}?cat=${cat}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed })
      });
      if (res.ok) { const b = await res.json(); if (Array.isArray(b.names)) this.assign(cat, b.names); }
    } catch { /* non-fatal */ }
  }

  async remove(cat: Cat, name: string): Promise<void> {
    try {
      const res = await fetch(`${API}?cat=${cat}`, {
        method: 'DELETE', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (res.ok) { const b = await res.json(); if (Array.isArray(b.names)) this.assign(cat, b.names); }
    } catch { /* non-fatal */ }
  }
}

export const terminalClasses = new TerminalClassesStore();
