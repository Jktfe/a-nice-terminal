/**
 * HTTP endpoints for the global Quick Shortcuts list (terminal chip bar).
 *
 * GET  /api/quick-shortcuts → list every shortcut, smallest order_index first.
 * POST /api/quick-shortcuts → create one shortcut from { label, text, autoEnter? }.
 *
 * Per JWPK 2026-05-15 lock: global scope (no per-terminal scoping), no auth
 * gate (user prefs, easy to recreate). Empty label / empty text after trim
 * fail with 400.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  createQuickShortcut,
  listQuickShortcuts
} from '$lib/server/quickShortcutsStore';

export const GET: RequestHandler = async () => {
  return json({ shortcuts: listQuickShortcuts() });
};

export const POST: RequestHandler = async ({ request }) => {
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with label and text fields.');
  }

  const labelFromBody = (rawBody as { label?: unknown }).label;
  if (typeof labelFromBody !== 'string') {
    throw error(400, 'The label field must be a string.');
  }

  const textFromBody = (rawBody as { text?: unknown }).text;
  if (typeof textFromBody !== 'string') {
    throw error(400, 'The text field must be a string.');
  }

  const autoEnterFromBody = (rawBody as { autoEnter?: unknown }).autoEnter;
  const autoEnter =
    typeof autoEnterFromBody === 'boolean' ? autoEnterFromBody : undefined;

  try {
    const shortcut = createQuickShortcut({
      label: labelFromBody,
      text: textFromBody,
      autoEnter
    });
    return json({ shortcut }, { status: 201 });
  } catch (causeOfFailure) {
    const message =
      causeOfFailure instanceof Error
        ? causeOfFailure.message
        : 'Could not create shortcut.';
    throw error(400, message);
  }
};
