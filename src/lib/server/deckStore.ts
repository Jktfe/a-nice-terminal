/**
 * deckStore — Task #126 v3-parity: room-scoped decks (slide presentations).
 *
 * Slides stored as JSON array so they are editable and renderable.
 * Supports create, list, get, update, soft-delete.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type DeckSlide = {
  id: string;
  title: string;
  content: string;
  layout?: string;
};

export type RoomDeck = {
  id: string;
  roomId: string;
  title: string;
  slides: DeckSlide[];
  theme: string | null;
  createdBy: string | null;
  accessPassword: string | null;
  parentDeckId: string | null;
  createdAtMs: number;
  updatedAtMs: number | null;
};

type DeckRow = {
  id: string;
  room_id: string;
  title: string;
  slides_json: string;
  theme: string | null;
  created_by: string | null;
  access_password: string | null;
  parent_deck_id: string | null;
  created_at_ms: number;
  updated_at_ms: number | null;
  deleted_at_ms: number | null;
};

type RawDeckSlide = {
  id?: unknown;
  title?: unknown;
  content?: unknown;
  body?: unknown;
  layout?: unknown;
};

function normalizeSlide(raw: unknown, index: number): DeckSlide | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const slide = raw as RawDeckSlide;
  const title = typeof slide.title === 'string' && slide.title.trim().length > 0
    ? slide.title
    : `Slide ${index + 1}`;
  const content = typeof slide.content === 'string'
    ? slide.content
    : (typeof slide.body === 'string' ? slide.body : '');
  const normalized: DeckSlide = {
    id: typeof slide.id === 'string' && slide.id.length > 0 ? slide.id : `slide-${index + 1}`,
    title,
    content
  };
  if (typeof slide.layout === 'string' && slide.layout.length > 0) {
    normalized.layout = slide.layout;
  }
  return normalized;
}

function normalizeSlides(rawSlides: unknown): DeckSlide[] {
  if (!Array.isArray(rawSlides)) return [];
  return rawSlides
    .map((slide, index) => normalizeSlide(slide, index))
    .filter((slide): slide is DeckSlide => slide !== null);
}

function rowToDeck(row: DeckRow): RoomDeck {
  let slides: DeckSlide[] = [];
  try {
    const parsed = JSON.parse(row.slides_json);
    slides = normalizeSlides(parsed);
  } catch { /* ignore malformed JSON */ }
  return {
    id: row.id,
    roomId: row.room_id,
    title: row.title,
    slides,
    theme: row.theme,
    createdBy: row.created_by,
    accessPassword: row.access_password,
    parentDeckId: row.parent_deck_id,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

export function createDeck(input: {
  roomId: string;
  title: string;
  slides?: DeckSlide[];
  theme?: string | null;
  createdBy?: string | null;
  accessPassword?: string | null;
  parentDeckId?: string | null;
  nowMs?: number;
}): RoomDeck {
  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length === 0) {
    throw new Error('title cannot be blank.');
  }
  const db = getIdentityDb();
  const id = randomUUID();
  const nowMs = input.nowMs ?? Date.now();
  const slides = normalizeSlides(input.slides ?? []);

  db.prepare(
    `INSERT INTO chat_room_decks
     (id, room_id, title, slides_json, theme, created_by, access_password, parent_deck_id, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, input.roomId, trimmedTitle,
    JSON.stringify(slides),
    input.theme ?? null,
    input.createdBy ?? null,
    input.accessPassword ?? null,
    input.parentDeckId ?? null,
    nowMs, nowMs
  );

  return {
    id,
    roomId: input.roomId,
    title: trimmedTitle,
    slides,
    theme: input.theme ?? null,
    createdBy: input.createdBy ?? null,
    accessPassword: input.accessPassword ?? null,
    parentDeckId: input.parentDeckId ?? null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs
  };
}

export function listDecksInRoom(roomId: string): RoomDeck[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT id, room_id, title, slides_json, theme, created_by, access_password, parent_deck_id, created_at_ms, updated_at_ms, deleted_at_ms
         FROM chat_room_decks
        WHERE room_id = ? AND deleted_at_ms IS NULL
        ORDER BY updated_at_ms DESC, created_at_ms DESC`
    )
    .all(roomId) as DeckRow[];
  return rows.map(rowToDeck);
}

/** Strip trailing punctuation that chat autolinkers often append
 *  when a URL is wrapped in markdown backticks or followed by punctuation.
 */
function normalizeDeckId(raw: string): string {
  return raw.replace(/[\\`]+$/g, '');
}

export function getDeck(id: string): RoomDeck | undefined {
  const cleanId = normalizeDeckId(id);
  const row = getIdentityDb()
    .prepare(
      `SELECT id, room_id, title, slides_json, theme, created_by, access_password, parent_deck_id, created_at_ms, updated_at_ms, deleted_at_ms
         FROM chat_room_decks
        WHERE id = ? AND deleted_at_ms IS NULL`
    )
    .get(cleanId) as DeckRow | undefined;
  return row ? rowToDeck(row) : undefined;
}

export function updateDeck(id: string, input: {
  title?: string;
  slides?: DeckSlide[];
  theme?: string | null;
  accessPassword?: string | null;
  nowMs?: number;
}): RoomDeck | undefined {
  const db = getIdentityDb();
  const existing = getDeck(id);
  if (!existing) return undefined;

  const nowMs = input.nowMs ?? Date.now();
  const title = input.title !== undefined ? input.title.trim() : existing.title;
  const slides = input.slides !== undefined ? normalizeSlides(input.slides) : existing.slides;
  const theme = input.theme !== undefined ? input.theme : existing.theme;
  const accessPassword = input.accessPassword !== undefined ? input.accessPassword : existing.accessPassword;

  if (title.length === 0) {
    throw new Error('title cannot be blank.');
  }

  db.prepare(
    `UPDATE chat_room_decks
        SET title = ?, slides_json = ?, theme = ?, access_password = ?, updated_at_ms = ?
      WHERE id = ? AND deleted_at_ms IS NULL`
  ).run(title, JSON.stringify(slides), theme, accessPassword, nowMs, id);

  return { ...existing, title, slides, theme, accessPassword, updatedAtMs: nowMs };
}

export function softDeleteDeck(id: string, nowMs?: number): boolean {
  const result = getIdentityDb()
    .prepare(
      `UPDATE chat_room_decks
          SET deleted_at_ms = ?
        WHERE id = ? AND deleted_at_ms IS NULL`
    )
    .run(nowMs ?? Date.now(), id);
  return result.changes > 0;
}

export function resetDeckStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM chat_room_decks`).run();
}
