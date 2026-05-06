export const SIDEBAR_PIN_STORAGE_KEY = 'ant.sidebar.pinned';
export const SIDEBAR_PIN_CHANGE_EVENT = 'ant:sidebar-pins-changed';

type PinStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function parsePinnedIds(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
  } catch {
    return new Set();
  }
}

export function readPinnedIds(storage: PinStorage | undefined): Set<string> {
  if (!storage) return new Set();
  return parsePinnedIds(storage.getItem(SIDEBAR_PIN_STORAGE_KEY));
}

export function writePinnedIds(ids: Set<string>, storage: PinStorage | undefined): void {
  if (!storage) return;
  storage.setItem(SIDEBAR_PIN_STORAGE_KEY, JSON.stringify(Array.from(ids)));
}

export function togglePinnedId(ids: Set<string>, id: string): Set<string> {
  if (ids.has(id)) {
    const next = new Set(ids);
    next.delete(id);
    return next;
  }
  return new Set([id, ...ids]);
}

// Reorder one pinned id to land just before another pinned id.
// Non-pinned ids and identical from/to are no-ops. The Set iteration order
// (= insertion order) is what `sidebarPinCompare` reads, so we rebuild the
// Set from a new array.
export function reorderPinnedIds(ids: Set<string>, fromId: string, toId: string): Set<string> {
  if (fromId === toId || !ids.has(fromId) || !ids.has(toId)) return ids;
  const arr = Array.from(ids);
  const fromIndex = arr.indexOf(fromId);
  if (fromIndex < 0) return ids;
  arr.splice(fromIndex, 1);
  const toIndex = arr.indexOf(toId);
  if (toIndex < 0) return ids;
  arr.splice(toIndex, 0, fromId);
  return new Set(arr);
}

export function notifySidebarPinsChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SIDEBAR_PIN_CHANGE_EVENT));
}
