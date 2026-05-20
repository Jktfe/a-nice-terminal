// ANT · Nocturne — runtime design tokens (V3-LIFT-1 2026-05-15)
// Trimmed lift from a-nice-terminal/src/lib/nocturne.ts — palette +
// AGENTS roster only. surfaceTokens + theme helpers deferred until a
// later lift needs them.

export const NOCTURNE = {
  emerald: {
    50: '#E8FAEC', 100: '#C6F3CF', 200: '#95E6A3', 300: '#5ED273',
    400: '#34D06F', 500: '#22C55E', 600: '#17A14B', 700: '#107B3A',
    800: '#0C5C2C', 900: '#083A1D'
  },
  blue: {
    50: '#EAF1FE', 100: '#CFDFFD', 200: '#A1BFFB', 300: '#6E9BF8',
    400: '#5A93F7', 500: '#3B82F6', 600: '#2A70EC', 700: '#1D5AD1',
    800: '#1747A8', 900: '#0F2E6E'
  },
  amber: {
    50: '#FFF8EC', 100: '#FEEDCA', 200: '#FCD990', 300: '#F9C052',
    400: '#F59E0B', 500: '#D98804', 600: '#B46D04', 700: '#8B5306',
    800: '#673E07', 900: '#432906'
  },
  pulse: { hot: '#B8F03E', mid: '#34D06F', deep: '#107B3A' },
  neutral: {
    50: '#F7F7F5', 100: '#EDEDE9', 200: '#DAD9D2', 300: '#B5B3A7',
    400: '#838173', 500: '#5A584B', 600: '#3E3D32', 700: '#2A2922',
    800: '#1B1A15', 900: '#100F0B'
  },
  ink: {
    50: '#E3E7F0', 100: '#BFC6D6', 200: '#8990A8', 300: '#565E7A',
    400: '#363E58', 500: '#222940', 600: '#161C30', 700: '#121828',
    800: '#0E1322', 900: '#0C1021'
  },
  semantic: {
    info: '#4285F4', success: '#22C55E',
    warning: '#F59E0B', danger: '#F04438'
  }
} as const;

export type AgentId = 'claude' | 'gemini' | 'codex' | 'copilot' | 'ollama' | 'lmstudio';

export const AGENTS: Record<AgentId, { color: string; glow: string; note: string }> = {
  claude:   { color: '#E07856', glow: '#F59A7E', note: 'coral'  },
  gemini:   { color: '#5B8DEF', glow: '#8AB0F5', note: 'azure'  },
  codex:    { color: '#2EBD85', glow: '#5ED8A6', note: 'jade'   },
  copilot:  { color: '#9B6BF0', glow: '#B896F5', note: 'violet' },
  ollama:   { color: '#F2B65A', glow: '#F6CE8A', note: 'gold'   },
  lmstudio: { color: '#EC89B4', glow: '#F2A9C8', note: 'rose'   }
};

export function surfaceTokens(mode: 'dark' | 'light') {
  if (mode === 'dark') {
    return {
      bg: NOCTURNE.ink[900], elev: NOCTURNE.ink[700],
      panel: NOCTURNE.ink[800], raised: NOCTURNE.ink[600],
      hairline: 'rgba(255,255,255,0.06)',
      hairlineStrong: 'rgba(255,255,255,0.10)',
      text: NOCTURNE.ink[50],
      textMuted: NOCTURNE.ink[200],
      textFaint: NOCTURNE.ink[300]
    };
  }
  return {
    bg: NOCTURNE.neutral[50], elev: '#FFFFFF',
    panel: '#FBFBFA', raised: '#FFFFFF',
    hairline: 'rgba(0,0,0,0.06)',
    hairlineStrong: 'rgba(0,0,0,0.10)',
    text: NOCTURNE.neutral[800],
    textMuted: NOCTURNE.neutral[500],
    textFaint: NOCTURNE.neutral[400]
  };
}

export function agentColor(key: string | null | undefined): { color: string; glow: string } {
  if (!key) return { color: NOCTURNE.ink[200], glow: NOCTURNE.ink[100] };
  const normalised = key.replace(/^@/, '').toLowerCase();
  if (normalised in AGENTS) return AGENTS[normalised as AgentId];
  const palette = Object.values(AGENTS);
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) & 0xffffffff;
  return palette[Math.abs(hash) % palette.length];
}
