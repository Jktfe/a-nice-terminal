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

export function notifySidebarPinsChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SIDEBAR_PIN_CHANGE_EVENT));
}
