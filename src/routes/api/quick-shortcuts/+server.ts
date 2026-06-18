/**
 * HTTP endpoints for the current user's Quick Shortcuts list (terminal chip bar).
 *
 * GET  /api/quick-shortcuts → list caller-owned shortcuts, smallest order_index first.
 * POST /api/quick-shortcuts → create one shortcut from { label, text, autoEnter? }.
 *
 * The browser-session handle is the owner key. Requests without a resolvable
 * caller fall back to the structural operator handle for CLI/test compatibility.
 * Empty label / empty text after trim fail with 400.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  createQuickShortcut,
  listQuickShortcuts
} from '$lib/server/quickShortcutsStore';
import { getOperatorHandle } from '$lib/server/operatorHandle';
import { resolveCallerHandleAnyRoom } from '$lib/server/authGate';

function ownerHandleFor(request: Request): string {
  return resolveCallerHandleAnyRoom(request) ?? getOperatorHandle();
}

export const GET: RequestHandler = async ({ request }) => {
  return json({ shortcuts: listQuickShortcuts(ownerHandleFor(request)) });
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
      ownerHandle: ownerHandleFor(request),
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
