/**
 * roomSidePanelPins store — per-room, per-device pin state for the right
 * side panel on the room view.
 *
 * Each user picks which RoomMenuDropdown sections (participants, focus,
 * asks, plans, tasks, linked-rooms, interviews, artefacts, screenshots,
 * memory, attachments) are PINNED to the right side panel for a given
 * room. Pinned sections render in the sticky right rail on desktop;
 * unpinned sections stay in the 'More' dropdown.
 *
 * Storage: localStorage only (per JWPK msg_r2qkxstx6k "it will change
 * from room to room (device to device)"). No server sync — different
 * devices manage their own preferences. Server sync is a clean
 * follow-up if cross-device pin sync is needed later.
 *
 * Key shape: `ant.sidepanel.<roomId>` → JSON array of section ids.
 *
 * v2 pattern (banked from the d51b0c3 / f4125ff regression cycle):
 * reads are pure (no $state writes), writes are explicit. Callers must
 * invoke init(roomId) once from onMount with a stable roomId snapshot;
 * thereafter getPinsForRoom / isPinned are safe to call inside $derived
 * because they only read. The reverted pattern called localStorage from
 * inside getPinsForRoom, which wrote to $state during $derived evaluation
 * and Svelte silently dropped the write — pin state appeared not to
 * persist across refresh, surfacing as the "pin disappeared" regression.
 */

const STORAGE_KEY_PREFIX = 'ant.sidepanel.';

function storageKeyFor(roomId: string): string {
  return `${STORAGE_KEY_PREFIX}${roomId}`;
}

function readPinsFromStorage(roomId: string): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(storageKeyFor(roomId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((x): x is string => typeof x === 'string' && x.length > 0)
    );
  } catch {
    return new Set();
  }
}

class RoomSidePanelPinsStore {
  // Per-room pin sets. Key = roomId, value = Set of pinned section ids.
  // $state holds the Map; getPinsForRoom returns the live Set without
  // writing — safe to call inside $derived.
  private byRoom = $state<Map<string, Set<string>>>(new Map());

  /**
   * Eager hydrate from localStorage for a roomId. Callers invoke once
   * from onMount() with a stable snapshot of the roomId. Idempotent: a
   * second call replaces the in-memory entry with the latest disk state
   * (useful if localStorage was edited externally).
   *
   * IMPORTANT: do NOT call from inside a $derived. Writes to $state
   * during $derived evaluation are silently dropped by Svelte 5 — the
   * banked anti-pattern that produced the d51b0c3 / f4125ff revert
   * cycle. Always invoke from onMount / event handlers / explicit
   * imperative flows.
   */
  init(roomId: string): void {
    const next = new Map(this.byRoom);
    next.set(roomId, readPinsFromStorage(roomId));
    this.byRoom = next;
  }

  /**
   * Read-only. Returns the live Set for a roomId (empty if init has not
   * yet been called for this roomId). Safe inside $derived.
   */
  getPinsForRoom(roomId: string): Set<string> {
    return this.byRoom.get(roomId) ?? new Set();
  }

  /**
   * Read-only. Safe inside $derived.
   */
  isPinned(roomId: string, sectionId: string): boolean {
    return this.getPinsForRoom(roomId).has(sectionId);
  }

  togglePin(roomId: string, sectionId: string): void {
    const current = new Set(this.byRoom.get(roomId) ?? []);
    if (current.has(sectionId)) {
      current.delete(sectionId);
    } else {
      current.add(sectionId);
    }
    const next = new Map(this.byRoom);
    next.set(roomId, current);
    this.byRoom = next;
    this.persist(roomId, current);
  }

  private persist(roomId: string, pins: Set<string>): void {
    if (typeof localStorage === 'undefined') return;
    try {
      if (pins.size === 0) {
        localStorage.removeItem(storageKeyFor(roomId));
      } else {
        localStorage.setItem(storageKeyFor(roomId), JSON.stringify([...pins]));
      }
    } catch {
      /* private mode or quota — surface state in memory, localStorage drops */
    }
  }
}

export const roomSidePanelPins = new RoomSidePanelPinsStore();
