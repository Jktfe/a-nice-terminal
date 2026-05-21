export type ContextFillReading = {
  fill: number;
  inputTokens: number;
  contextWindow: number;
};

export function contextFillFromTokens(
  inputTokens: number,
  contextWindow: number
): ContextFillReading | null {
  if (!Number.isFinite(inputTokens) || inputTokens < 0) return null;
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return null;
  return {
    fill: Math.min(1, inputTokens / contextWindow),
    inputTokens,
    contextWindow
  };
}

export function numberValue(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
