export type TerminalRendererMode = 'dom' | 'webgl';

export type RendererFlagSource = 'url' | 'localStorage' | 'env' | 'default';

export interface RendererFlagDecision {
  mode: TerminalRendererMode;
  source: RendererFlagSource;
  raw: string | null;
}

export const TERMINAL_RENDERER_STORAGE_KEY = 'ant-terminal-renderer';

function normaliseRendererMode(value: string | null | undefined): TerminalRendererMode | null {
  if (!value) return null;
  const normalised = value.trim().toLowerCase();
  if (normalised === 'webgl') return 'webgl';
  if (normalised === 'dom') return 'dom';
  return null;
}

function firstValidEnvValue(envValues: Array<string | null | undefined>): string | null {
  return envValues.find((value) => normaliseRendererMode(value) !== null) ?? null;
}

export function resolveTerminalRendererFlag(input: {
  search?: string | null;
  storageValue?: string | null;
  envValues?: Array<string | null | undefined>;
}): RendererFlagDecision {
  const params = new URLSearchParams(input.search ?? '');
  const urlValue = params.get('renderer') ?? params.get('RENDERER');
  const urlMode = normaliseRendererMode(urlValue);
  if (urlMode) return { mode: urlMode, source: 'url', raw: urlValue };

  const storageMode = normaliseRendererMode(input.storageValue);
  if (storageMode) return { mode: storageMode, source: 'localStorage', raw: input.storageValue ?? null };

  const envValue = firstValidEnvValue(input.envValues ?? []);
  const envMode = normaliseRendererMode(envValue);
  if (envMode) return { mode: envMode, source: 'env', raw: envValue };

  return { mode: 'dom', source: 'default', raw: null };
}

export async function waitForTerminalFonts(doc: Document): Promise<boolean> {
  const fonts = doc.fonts;
  if (!fonts?.ready) return false;
  try {
    await fonts.ready;
    return true;
  } catch {
    return false;
  }
}
