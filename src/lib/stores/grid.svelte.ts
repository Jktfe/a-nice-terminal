import { browser } from '$app/environment';

export interface GridCell {
  id: string;
  sessionId: string | null;
}

const STORAGE_KEY = 'ant-grid-v1';
const MIN = 1;
const MAX = 5;

// crypto.randomUUID is only exposed on secure contexts (HTTPS, localhost,
// file://). Accessing the dashboard over plain HTTP via a Tailscale
// hostname is non-secure, so fall back to getRandomValues which is always
// available.
function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}

function makeCell(sessionId: string | null = null): GridCell {
  return { id: uuid(), sessionId };
}

function defaultCells(cols: number, rows: number): GridCell[] {
  return Array.from({ length: cols * rows }, () => makeCell());
}

// ── Module-level reactive state (singleton, same pattern as sessions.svelte.ts) ──
let enabled = $state(false);
let cols = $state(2);
let rows = $state(2);
let cells = $state<GridCell[]>(defaultCells(2, 2));

// Load from localStorage once on first import (browser only)
if (browser) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const savedEnabled = saved.enabled ?? false;
      const savedCols = Math.min(MAX, Math.max(MIN, saved.cols ?? 2));
      const savedRows = Math.min(MAX, Math.max(MIN, saved.rows ?? 2));
      const savedCells: GridCell[] = saved.cells ?? [];
      const needed = savedCols * savedRows;
      enabled = savedEnabled;
      cols = savedCols;
      rows = savedRows;
      cells = Array.from({ length: needed }, (_, i) =>
        savedCells[i] ?? makeCell()
      );
    }
  } catch {
    // Corrupt storage — use defaults
  }
}

export function useGridStore() {
  // Persist on every change
  $effect(() => {
    if (!browser) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled, cols, rows, cells }));
  });

  function toggle() {
    enabled = !enabled;
  }

  function setDimensions(newCols: number, newRows: number) {
    newCols = Math.min(MAX, Math.max(MIN, newCols));
    newRows = Math.min(MAX, Math.max(MIN, newRows));
    const needed = newCols * newRows;
    // Preserve existing assignments by position index
    const next = Array.from({ length: needed }, (_, i) =>
      cells[i] ?? makeCell()
    );
    cols = newCols;
    rows = newRows;
    cells = next;
  }

  function assignCell(cellId: string, sessionId: string) {
    cells = cells.map(c => c.id === cellId ? { ...c, sessionId } : c);
  }

  function clearCell(cellId: string) {
    cells = cells.map(c => c.id === cellId ? { ...c, sessionId: null } : c);
  }

  return {
    get enabled() { return enabled; },
    get cols() { return cols; },
    get rows() { return rows; },
    get cells() { return cells; },
    toggle,
    setDimensions,
    assignCell,
    clearCell,
  };
}
