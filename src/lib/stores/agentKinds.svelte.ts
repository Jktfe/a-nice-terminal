/**
 * agentKinds store — T-AGENT-LIST-SETTINGS 2026-05-14.
 *
 * Per-client preference for the list of available agent-kind labels
 * surfaced in TerminalHeader dropdown + claim modal select. JWPK spec:
 * configurable list, label decoupled from canonical classifier kind via
 * server-side classifier alias (researchant lane).
 *
 * Defaults seed JWPK's 7: pi, qwen, gemini, copilot, codex, claude, perspective.
 * Mirrors theme.svelte.ts state-class pattern.
 */
const STORAGE_KEY = 'ant-agent-kinds';
const DEFAULTS = ['pi', 'qwen', 'gemini', 'copilot', 'codex', 'claude', 'perspective'];

class AgentKindsStore {
  enabled = $state<string[]>([...DEFAULTS]);

  init() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        this.enabled = parsed.filter((s) => s.length > 0);
      }
    } catch { /* malformed — keep defaults */ }
  }

  add(label: string): void {
    const trimmed = label.trim();
    if (!trimmed) return;
    if (this.enabled.includes(trimmed)) return;
    this.enabled = [...this.enabled, trimmed];
    this.persist();
  }

  remove(label: string): void {
    this.enabled = this.enabled.filter((x) => x !== label);
    this.persist();
  }

  toggle(label: string): void {
    if (this.enabled.includes(label)) this.remove(label);
    else this.add(label);
  }

  reset(): void {
    this.enabled = [...DEFAULTS];
    this.persist();
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.enabled)); }
    catch { /* private mode */ }
  }
}

export const agentKinds = new AgentKindsStore();
