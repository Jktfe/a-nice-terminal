// ANT v3 — Toast notification store
// Module-level $state is shared across all importers (singleton).
// useToasts() returns the same reactive list from everywhere — no context needed.

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  durationMs: number;
  remainingMs: number;
  paused: boolean;
}

export const DEFAULT_TOAST_DURATION_MS = 7000;

let toasts = $state<Toast[]>([]);
let _nextId = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const startedAt = new Map<number, number>();

function clearTimer(id: number) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  startedAt.delete(id);
}

export function useToasts() {
  function show(message: string, kind: ToastKind = 'success', durationMs = DEFAULT_TOAST_DURATION_MS) {
    const id = ++_nextId;
    const safeDuration = Math.max(0, durationMs);
    toasts = [...toasts, { id, message, kind, durationMs: safeDuration, remainingMs: safeDuration, paused: false }];
    if (safeDuration <= 0) {
      dismiss(id);
      return;
    }
    startedAt.set(id, Date.now());
    timers.set(id, setTimeout(() => dismiss(id), safeDuration));
  }

  function dismiss(id: number) {
    clearTimer(id);
    toasts = toasts.filter(t => t.id !== id);
  }

  function pause(id: number) {
    const toast = toasts.find(t => t.id === id);
    if (!toast || toast.paused) return;
    const elapsed = Math.max(0, Date.now() - (startedAt.get(id) ?? Date.now()));
    const remainingMs = Math.max(0, toast.remainingMs - elapsed);
    clearTimer(id);
    toasts = toasts.map(t => t.id === id ? { ...t, remainingMs, paused: true } : t);
  }

  function resume(id: number) {
    const toast = toasts.find(t => t.id === id);
    if (!toast || !toast.paused) return;
    if (toast.remainingMs <= 0) {
      dismiss(id);
      return;
    }
    toasts = toasts.map(t => t.id === id ? { ...t, paused: false } : t);
    startedAt.set(id, Date.now());
    timers.set(id, setTimeout(() => dismiss(id), toast.remainingMs));
  }

  return {
    get list() { return toasts; },
    show,
    dismiss,
    pause,
    resume,
  };
}
