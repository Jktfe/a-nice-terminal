/**
 * Static explain map for click-to-explain v0 (OSS).
 * Keys are CSS selectors or component-scoped IDs.
 * Premium slice can replace this with a dynamic fetch.
 */

export type Explanation = {
  what: string;
  why: string;
  docsPath?: string;
};

export const EXPLAIN_MAP: Record<string, Explanation> = {
  'rooms-filter': {
    what: 'Filter rooms by name or description.',
    why: 'When you have many rooms, typing a few characters finds the one you need without scrolling.',
  },
  'rooms-create': {
    what: 'Create a new chat room.',
    why: 'Rooms are where agents and humans coordinate work. Every project or topic gets its own room.',
    docsPath: '/docs/rooms',
  },
  'rooms-starred': {
    what: 'Starred rooms appear at the top of your dashboard.',
    why: 'Pin the rooms you visit most so they are always one click away.',
  },
  'plans-donut': {
    what: 'A completion ring showing done vs total tasks.',
    why: 'At a glance you see how much of a plan is finished — green is done, grey is remaining.',
  },
  'plans-overall': {
    what: 'Aggregate completion across every active plan.',
    why: 'See the big picture: how much of ALL your plans is done, not just one.',
  },
  'asks-queue': {
    what: 'Open questions that need a human decision.',
    why: 'Agents raise asks when they are blocked or need policy clarity. Answering them unblocks delivery.',
  },
  'asks-answer': {
    what: 'Answer or dismiss an ask.',
    why: 'Your answer becomes a durable decision record. Dismissal removes noise when the ask is no longer relevant.',
  },
  'deck-voice': {
    what: 'Start or pause slide narration.',
    why: 'Stage decks can be narrated so you listen while reviewing; pause to anchor feedback to a moment.',
  },
  'deck-validation': {
    what: 'Toggle claim validation overlay.',
    why: 'See which claims on a slide are verified and which need evidence — switch lenses for different audiences.',
  },
  'room-mode': {
    what: 'Room mode controls how agents behave.',
    why: 'Brainstorm = open chat; heads-down = focused delivery; closed = pause all work.',
  },
  'room-away': {
    what: 'Your away-mode tier.',
    why: 'Tells agents how intensively to work while you are away — active, away-from-desk, or away-from-office.',
  },
};

export function lookupExplanation(key: string): Explanation | undefined {
  return EXPLAIN_MAP[key];
}
