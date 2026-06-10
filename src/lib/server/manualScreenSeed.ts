/**
 * Manual canvas v2 — first-state seed (slice 1, JWPK 2026-05-23).
 *
 * Idempotent seed for the /rooms default-state annotations. Runs on
 * first boot when manual_screen_states is empty; subsequent boots
 * skip. Hand-authored coordinates against the existing 2560×1600
 * screenshot at external asset manual/rooms-index.png, served through
 * /api/assets/manual/rooms-index.png. Auto-extract (slice 5)
 * will replace this seed path with a Playwright-driven generator.
 */

import { getIdentityDb } from './db';
import { upsertScreenState, upsertAnnotation } from './manualScreenStore';

const ROOMS_INDEX_SEED = {
  screenId: 'rooms-index',
  stateSlug: 'default',
  stateLabel: 'Default (no rooms / first visit)',
  description: 'The rooms-index landing page in its quiet initial state — title card visible, create-form ready, your-rooms list rendered.',
  screenshotPath: '/api/assets/manual/rooms-index.png',
  viewportW: 2560,
  viewportH: 1600
};

// Bounding boxes in 2560×1600 pixel coordinates (matching the
// screenshot). The page renderer scales these into the displayed
// image's space. Tab order follows reading order: top→bottom,
// left→right within each row.
const ROOMS_INDEX_ELEMENTS = [
  {
    elementSlug: 'nav-logo',
    itemName: 'ANT brand mark',
    bbox: { x: 30, y: 20, w: 200, h: 80 },
    cliVerbs: [],
    dataSources: ['client-side route mount'],
    logicText: 'Static brand mark; clicking returns to the home route. No data-fetch.',
    intendedActions: ['Click to go home']
  },
  {
    elementSlug: 'nav-icons',
    itemName: 'Navigation icons',
    bbox: { x: 1900, y: 20, w: 640, h: 80 },
    cliVerbs: [],
    dataSources: ['SimplePageShell.svelte nav config'],
    logicText: 'Top-right icon strip exposes cross-screen jumps (rooms / plans / agents / search / settings / theme).',
    intendedActions: ['Jump to another screen', 'Toggle theme', 'Open search']
  },
  {
    elementSlug: 'title-card',
    itemName: 'Title card — "Start, join, and steer rooms."',
    bbox: { x: 40, y: 130, w: 2480, h: 380 },
    cliVerbs: [],
    dataSources: [],
    logicText: 'Top-of-page hero card. The "ROOM WORK" eyebrow pill, h1 title, and one-line summary establish the screen\'s purpose before the action below.',
    intendedActions: ['Read for context']
  },
  {
    elementSlug: 'create-room-input',
    itemName: '"Give the room a name" input',
    bbox: { x: 40, y: 660, w: 880, h: 80 },
    cliVerbs: ['ant rooms create --name <NAME>'],
    dataSources: ['POST /api/chat-rooms (server-side createChatRoom)'],
    logicText: 'Single-line text input. Empty input disables the Create-room button. Hitting Enter submits the form.',
    intendedActions: ['Type a name', 'Press Enter to create']
  },
  {
    elementSlug: 'create-room-button',
    itemName: '"Create room" button',
    bbox: { x: 40, y: 780, w: 250, h: 90 },
    cliVerbs: ['ant rooms create --name <NAME>'],
    dataSources: ['POST /api/chat-rooms', 'roomBookmarks store (auto-star creator)'],
    logicText: 'Disabled when input is empty. On click: POSTs new room, navigates to the new room URL, auto-stars in roomBookmarks.',
    intendedActions: ['Create a new room from the typed name']
  },
  {
    elementSlug: 'list-grid-toggle',
    itemName: 'List / Grid toggle',
    bbox: { x: 2330, y: 1000, w: 200, h: 60 },
    cliVerbs: [],
    dataSources: ['localStorage "roomsIndexViewMode"'],
    logicText: 'Toggles the Your-rooms section between List (compact lines) and Grid (card tiles). Persisted per-browser.',
    intendedActions: ['Switch view density']
  },
  {
    elementSlug: 'first-room-card',
    itemName: 'Room card — "windows/Tauri antchat app"',
    bbox: { x: 20, y: 1140, w: 2520, h: 220 },
    cliVerbs: ['ant rooms enter <ROOM_ID>'],
    dataSources: ['listChatRooms (chat_rooms table)', 'last_post_order (slice H room sort)'],
    logicText: 'A single row in the Your-rooms list. Shows room name, latest message preview, agent avatars, and a star toggle. Sort by last_post_order DESC (most-recently-active first).',
    intendedActions: ['Click to enter the room', 'Star to pin to top', 'Hover to preview latest messages']
  },
  {
    elementSlug: 'room-star',
    itemName: 'Star (pin to top)',
    bbox: { x: 2470, y: 1170, w: 60, h: 60 },
    cliVerbs: ['ant rooms star <ROOM_ID>'],
    dataSources: ['roomBookmarks store (POST /api/room-bookmarks)'],
    logicText: 'Click toggles starred state for the current user. Starred rooms float to the top of the list (and persist across sessions via roomBookmarks store).',
    intendedActions: ['Pin this room above the rest']
  }
];

export function seedManualScreensIfEmpty(): void {
  try {
    const db = getIdentityDb();
    const existing = db
      .prepare(`SELECT COUNT(*) AS count FROM manual_screen_states`)
      .get() as { count: number };
    if (existing.count > 0) return;

    upsertScreenState({
      screenId: ROOMS_INDEX_SEED.screenId,
      stateSlug: ROOMS_INDEX_SEED.stateSlug,
      stateLabel: ROOMS_INDEX_SEED.stateLabel,
      description: ROOMS_INDEX_SEED.description,
      screenshotPath: ROOMS_INDEX_SEED.screenshotPath,
      viewportW: ROOMS_INDEX_SEED.viewportW,
      viewportH: ROOMS_INDEX_SEED.viewportH,
      sortOrder: 0
    });

    ROOMS_INDEX_ELEMENTS.forEach((element, index) => {
      upsertAnnotation({
        screenId: ROOMS_INDEX_SEED.screenId,
        stateSlug: ROOMS_INDEX_SEED.stateSlug,
        elementSlug: element.elementSlug,
        itemName: element.itemName,
        bbox: element.bbox,
        cliVerbs: element.cliVerbs,
        dataSources: element.dataSources,
        logicText: element.logicText,
        intendedActions: element.intendedActions,
        tabOrder: index
      });
    });
  } catch {
    /* idempotent — failures (test env, missing tables) swallow */
  }
}
