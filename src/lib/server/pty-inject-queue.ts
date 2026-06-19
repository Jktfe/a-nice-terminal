/**
 * pty-inject-queue — per-handle batch queue for tmux injection.
 *
 * Why this exists: bursty rooms (5 agents posting within 2 seconds) would
 * blast 5 paste-buffer events into every recipient pane, breaking prompts
 * on slow CLIs. v3 learned this the hard way (per project_focus_mode);
 * the per-handle queue + 500ms batch flush prevents the thrash.
 *
 * Each handle has its own pending list. First message schedules a 500ms
 * flush; subsequent messages within the window join the same flush.
 * Flush callback is responsible for invoking the bridge with the batched
 * envelope.
 */

const DEFAULT_FLUSH_DELAY_MS = 500;

export type QueuedMessage<T> = T;

type ScheduledHandle = unknown;

type QueueEntry<T> = {
  pending: QueuedMessage<T>[];
  timer: ScheduledHandle | null;
};

export type FlushCallback<T> = (handle: string, batch: QueuedMessage<T>[]) => void;

export type InjectQueueOptions<T> = {
  flushDelayMs?: number;
  scheduler?: (cb: () => void, ms: number) => ScheduledHandle;
  cancelScheduler?: (id: ScheduledHandle) => void;
  onFlushError?: (handle: string, batch: QueuedMessage<T>[], cause: unknown) => void;
};

export function makeInjectQueue<T>(onFlush: FlushCallback<T>, options: InjectQueueOptions<T> = {}) {
  const flushDelay = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
  const scheduler = options.scheduler ?? ((cb: () => void, ms: number) => setTimeout(cb, ms) as ScheduledHandle);
  const cancel = options.cancelScheduler ?? ((id: ScheduledHandle) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const queues = new Map<string, QueueEntry<T>>();

  function getOrCreateEntry(handle: string): QueueEntry<T> {
    const existing = queues.get(handle);
    if (existing) return existing;
    const created: QueueEntry<T> = { pending: [], timer: null };
    queues.set(handle, created);
    return created;
  }

  function flushHandle(handle: string): void {
    const entry = queues.get(handle);
    if (!entry || entry.pending.length === 0) return;
    if (entry.timer !== null) {
      cancel(entry.timer);
      entry.timer = null;
    }
    const batch = entry.pending.splice(0, entry.pending.length);
    try {
      onFlush(handle, batch);
    } catch (cause) {
      entry.pending.unshift(...batch);
      try { options.onFlushError?.(handle, batch, cause); } catch { /* diagnostics hook only */ }
    }
  }

  function enqueue(handle: string, message: QueuedMessage<T>): void {
    const entry = getOrCreateEntry(handle);
    entry.pending.push(message);
    if (entry.timer === null) {
      entry.timer = scheduler(() => {
        entry.timer = null;
        flushHandle(handle);
      }, flushDelay);
    }
  }

  function immediateFlush(handle: string): void {
    flushHandle(handle);
  }

  function pendingCountForTests(handle: string): number {
    return queues.get(handle)?.pending.length ?? 0;
  }

  function resetForTests(): void {
    for (const entry of queues.values()) {
      if (entry.timer !== null) cancel(entry.timer);
    }
    queues.clear();
  }

  return { enqueue, immediateFlush, pendingCountForTests, resetForTests };
}
