// ANT v3 — CLI Mode definitions
// Each entry describes a supported AI CLI tool that can run inside a terminal session.
// `stripLines` = number of bottom-of-screen UI chrome lines to strip before diffing.

export const CLI_MODES = [
  { slug: 'claude-code',  label: 'Claude',      icon: '🟣', stripLines: 15 },
  { slug: 'codex-cli',    label: 'Codex',       icon: '🟢', stripLines: 15 },
  { slug: 'gemini-cli',   label: 'Gemini',      icon: '🔵', stripLines: 15 },
  { slug: 'copilot',      label: 'Copilot',     icon: '⚪', stripLines: 15 },
  { slug: 'ollama',       label: 'Ollama',      icon: '🦙', stripLines: 15 },
  { slug: 'perspective',  label: 'Perspective',  icon: '🍎', stripLines: 15 },
  { slug: 'msty',         label: 'Msty',        icon: '🔮', stripLines: 15 },
  { slug: 'lm-studio',   label: 'LM Studio',   icon: '🧪', stripLines: 15 },
  { slug: 'llamafile',   label: 'llamafile',    icon: '📦', stripLines: 15 },
  { slug: 'llm',         label: 'llm',          icon: '💬', stripLines: 15 },
  { slug: 'pi',          label: 'Pi',           icon: '🥧', stripLines: 15 },
  { slug: 'lemonade',    label: 'lemonade',     icon: '🍋', stripLines: 15 },
  { slug: 'mlx-lm',      label: 'mlx_lm',      icon: '🍎', stripLines: 15 },
] as const;

export type CliSlug = (typeof CLI_MODES)[number]['slug'];

/** Lookup a mode by slug. Returns undefined if not found. */
export function getCliMode(slug: string | null | undefined) {
  if (!slug) return undefined;
  return CLI_MODES.find(m => m.slug === slug);
}

/** Set of valid slugs for validation. */
export const CLI_SLUGS = new Set(CLI_MODES.map(m => m.slug));
