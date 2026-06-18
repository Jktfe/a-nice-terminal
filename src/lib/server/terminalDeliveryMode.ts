export type TerminalDeliveryMode = 'inject' | 'queue_raw' | 'queue_summarise';
export type TerminalDeliveryTargetMode = 'room_flow' | 'handle_only';

export const TERMINAL_DELIVERY_MODES: readonly TerminalDeliveryMode[] = [
  'inject',
  'queue_raw',
  'queue_summarise'
];

export const TERMINAL_DELIVERY_TARGET_MODES: readonly TerminalDeliveryTargetMode[] = [
  'room_flow',
  'handle_only'
];

export function isTerminalDeliveryMode(value: unknown): value is TerminalDeliveryMode {
  return typeof value === 'string' && (TERMINAL_DELIVERY_MODES as readonly string[]).includes(value);
}

export function isTerminalDeliveryTargetMode(value: unknown): value is TerminalDeliveryTargetMode {
  return typeof value === 'string' && (TERMINAL_DELIVERY_TARGET_MODES as readonly string[]).includes(value);
}

function parseMeta(metaRaw: string | null | undefined): Record<string, unknown> {
  if (!metaRaw) return {};
  try {
    const parsed = JSON.parse(metaRaw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function readTerminalDeliveryMode(metaRaw: string | null | undefined): TerminalDeliveryMode {
  const meta = parseMeta(metaRaw);
  return isTerminalDeliveryMode(meta.deliveryMode) ? meta.deliveryMode : 'inject';
}

export function readTerminalDeliveryTargetMode(metaRaw: string | null | undefined): TerminalDeliveryTargetMode {
  const meta = parseMeta(metaRaw);
  return isTerminalDeliveryTargetMode(meta.deliveryTargetMode) ? meta.deliveryTargetMode : 'room_flow';
}

export function curatorModeForDeliveryMode(mode: TerminalDeliveryMode): 'parse' | 'off' {
  return mode === 'queue_raw' ? 'off' : 'parse';
}
