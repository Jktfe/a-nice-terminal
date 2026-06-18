/**
 * Update or delete one quick shortcut.
 *
 * PATCH  /api/quick-shortcuts/:id → patch label/text/autoEnter, 200 / 404.
 * DELETE /api/quick-shortcuts/:id → hard-delete, 204 / 404.
 *
 * Empty trimmed label or text on PATCH fails with 400 (mirrors POST).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  deleteQuickShortcut,
  findQuickShortcutById,
  updateQuickShortcut
} from '$lib/server/quickShortcutsStore';
import { getOperatorHandle } from '$lib/server/operatorHandle';
import { resolveCallerHandleAnyRoom } from '$lib/server/authGate';

function ownerHandleFor(request: Request): string {
  return resolveCallerHandleAnyRoom(request) ?? getOperatorHandle();
}

export const PATCH: RequestHandler = async ({ params, request }) => {
  const ownerHandle = ownerHandleFor(request);
  const existing = findQuickShortcutById(params.id, ownerHandle);
  if (!existing) {
    throw error(404, 'Quick shortcut not found.');
  }

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with at least one of label, text, autoEnter.');
  }

  const labelFromBody = (rawBody as { label?: unknown }).label;
  const textFromBody = (rawBody as { text?: unknown }).text;
  const autoEnterFromBody = (rawBody as { autoEnter?: unknown }).autoEnter;

  const patch: { label?: string; text?: string; autoEnter?: boolean } = {};
  if (labelFromBody !== undefined) {
    if (typeof labelFromBody !== 'string') {
      throw error(400, 'The label field must be a string.');
    }
    patch.label = labelFromBody;
  }
  if (textFromBody !== undefined) {
    if (typeof textFromBody !== 'string') {
      throw error(400, 'The text field must be a string.');
    }
    patch.text = textFromBody;
  }
  if (autoEnterFromBody !== undefined) {
    if (typeof autoEnterFromBody !== 'boolean') {
      throw error(400, 'The autoEnter field must be a boolean.');
    }
    patch.autoEnter = autoEnterFromBody;
  }

  try {
    const shortcut = updateQuickShortcut(params.id, patch, ownerHandle);
    if (!shortcut) {
      throw error(404, 'Quick shortcut not found.');
    }
    return json({ shortcut });
  } catch (causeOfFailure) {
    if (causeOfFailure instanceof Response) throw causeOfFailure;
    // SvelteKit error() throws an HttpError shape with status — re-raise unchanged.
    const maybeHttp = causeOfFailure as { status?: number };
    if (typeof maybeHttp?.status === 'number') throw causeOfFailure;
    const message =
      causeOfFailure instanceof Error
        ? causeOfFailure.message
        : 'Could not update shortcut.';
    throw error(400, message);
  }
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  const wasDeleted = deleteQuickShortcut(params.id, ownerHandleFor(request));
  if (!wasDeleted) {
    throw error(404, 'Quick shortcut not found.');
  }
  return new Response(null, { status: 204 });
};
