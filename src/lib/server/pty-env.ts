export const PTY_HOST_TERM = 'xterm-256color';
export const PTY_TMUX_TERM = 'tmux-256color';

export function hasUsableTerm(value: string | undefined): value is string {
  return !!value && value.trim() !== '' && value !== 'dumb';
}

export function ensureUsableTerm(
  env: Record<string, string | undefined>,
  fallback = PTY_HOST_TERM,
): Record<string, string | undefined> {
  if (!hasUsableTerm(env.TERM)) {
    env.TERM = fallback;
  }
  return env;
}

export function resolveOriginalZdotdir(
  env: Record<string, string | undefined>,
  runtimeZdotdir: string,
  home: string,
): string {
  const candidates = [env.ANT_ORIGINAL_ZDOTDIR, env.ZDOTDIR, home];
  for (const candidate of candidates) {
    if (!candidate || candidate === runtimeZdotdir) continue;
    if (candidate.includes('/.ant/hooks/runtime/')) continue;
    return candidate;
  }
  return home;
}
