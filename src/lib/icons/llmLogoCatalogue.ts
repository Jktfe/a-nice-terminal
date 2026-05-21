/**
 * Catalogue of LLM/agent logos served from /static/llm-icons/.
 *
 * Each entry maps a stable `slug` (the value stored in chat_room_members
 * .display_icon as `logo:<slug>`) to:
 *   - `file`: the filename under /static/llm-icons/ (so picker
 *     thumbnails resolve against the same URL the renderer uses)
 *   - `label`: a short, human-readable name for the picker tooltip and
 *     aria-label
 *
 * Add a new logo by dropping the SVG into /static/llm-icons/ and
 * appending an entry here. No server-side change is needed because the
 * displayIcon column is just a string.
 */

export type LlmLogo = {
  slug: string;
  file: string;
  label: string;
};

export const LLM_LOGOS: readonly LlmLogo[] = [
  { slug: 'claude-icon.svg', file: 'claude-icon.svg', label: 'Claude' },
  { slug: 'claudecode-icon.svg', file: 'claudecode-icon.svg', label: 'Claude Code' },
  { slug: 'codex-icon.svg', file: 'codex-icon.svg', label: 'Codex' },
  { slug: 'gemini-icon.svg', file: 'gemini-icon.svg', label: 'Gemini' },
  { slug: 'geminicli-icon.svg', file: 'geminicli-icon.svg', label: 'Gemini CLI' },
  { slug: 'openai-icon.svg', file: 'openai-icon.svg', label: 'OpenAI' },
  { slug: 'copilot-icon.svg', file: 'copilot-icon.svg', label: 'GitHub Copilot' },
  { slug: '365-copilot-icon.svg', file: '365-copilot-icon.svg', label: 'Microsoft 365 Copilot' },
  { slug: 'kimi-icon.svg', file: 'kimi-icon.svg', label: 'Kimi' },
  { slug: 'qwen-icon.svg', file: 'qwen-icon.svg', label: 'Qwen' },
  { slug: 'glm(Z)-icon.svg', file: 'glm(Z)-icon.svg', label: 'GLM' },
  { slug: 'deepseek-icon.svg', file: 'deepseek-icon.svg', label: 'DeepSeek' },
  { slug: 'meta-icon.svg', file: 'meta-icon.svg', label: 'Meta' },
  { slug: 'minimax-icon.svg', file: 'minimax-icon.svg', label: 'MiniMax' },
  { slug: 'mistral-icon.svg', file: 'mistral-icon.svg', label: 'Mistral' },
  { slug: 'perplexity-icon.svg', file: 'perplexity-icon.svg', label: 'Perplexity' },
  { slug: 'pi-coding-agent-icon.svg', file: 'pi-coding-agent-icon.svg', label: 'Pi Coding Agent' },
  { slug: 'antigravity-icon.svg', file: 'antigravity-icon.svg', label: 'Antigravity' },
  { slug: 'perspective-intelligence-icon.svg', file: 'perspective-intelligence-icon.svg', label: 'Perspective Intelligence' },
  { slug: 'afm-icon.svg', file: 'afm-icon.svg', label: 'AFM' },
  { slug: 'ollama-icon.svg', file: 'ollama-icon.svg', label: 'Ollama' },
  { slug: 'lmstudio-icon.svg', file: 'lmstudio-icon.svg', label: 'LM Studio' },
  { slug: 'huggingface.svg', file: 'huggingface.svg', label: 'Hugging Face' },
  { slug: 'glama.svg', file: 'glama.svg', label: 'Glama' },
  { slug: 'mcp.svg', file: 'mcp.svg', label: 'MCP' },
  { slug: 'suno.svg', file: 'suno.svg', label: 'Suno' }
];

/** Sanity guard for the server-side parseShortIcon validator. */
export function isKnownLogoSlug(slug: string): boolean {
  return LLM_LOGOS.some((entry) => entry.slug === slug);
}

/** Helper used by `<MemberIcon>` and tests to resolve a displayIcon
 *  string of the form `logo:<slug>` back to its registered file URL. */
export function logoUrlForDisplayIcon(displayIcon: string | null | undefined): string | null {
  if (typeof displayIcon !== 'string') return null;
  if (!displayIcon.startsWith('logo:')) return null;
  const slug = displayIcon.slice('logo:'.length).trim();
  const entry = LLM_LOGOS.find((row) => row.slug === slug);
  return entry ? `/llm-icons/${entry.file}` : null;
}
