// ANT v3 — Toast notification store
// Module-level $state is shared across all importers (singleton).
// useToasts() returns the same reactive list from everywhere — no context needed.

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

let toasts = $state<Toast[]>([]);
let _nextId = 0;

export function useToasts() {
  function show(message: string, kind: ToastKind = 'success', durationMs = 3000) {
    const id = ++_nextId;
    toasts = [...toasts, { id, message, kind }];
    setTimeout(() => dismiss(id), durationMs);
  }

  function dismiss(id: number) {
    toasts = toasts.filter(t => t.id !== id);
  }

  return {
    get list() { return toasts; },
    show,
    dismiss,
  };
}
