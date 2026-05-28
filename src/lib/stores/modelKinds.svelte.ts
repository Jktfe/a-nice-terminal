/**
 * modelKinds store — JWPK msg_fespxsi2lu + msg_05lh00n3wg antV4
 * 2026-05-28: terminals are already tagged + grouped by CLI; users
 * also want to flag + group by model ("how many Kimis in Codex vs
 * Codex in Codex"). Same per-client preference shape as agentKinds so
 * the Settings UI and the per-terminal dropdown share patterns.
 *
 * Mirrors the agentKinds store exactly: enabled[], add/remove/toggle/
 * reset, localStorage-backed, defaults seeded. Free-form labels so
 * the user chooses how to name them — these are aesthetic tags, not
 * canonical model IDs.
 */
const STORAGE_KEY = 'ant-model-kinds';
const DEFAULTS = [
  'claude-opus',
  'claude-sonnet',
  'claude-haiku',
  'kimi',
  'codex',
  'gpt-5',
  'gemini-pro',
  'qwen'
];

class ModelKindsStore {
  enabled = $state<string[]>([...DEFAULTS]);

  init(): void {
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
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.enabled));
    } catch {
      /* private mode */
    }
  }
}

export const modelKinds = new ModelKindsStore();
