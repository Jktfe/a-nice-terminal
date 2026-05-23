// PATCH /api/manual/states/:screenId/:stateSlug/annotations/:elementSlug
// DELETE /api/manual/states/:screenId/:stateSlug/annotations/:elementSlug
// Author-mode endpoints (slice 1.5).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getIdentityDb } from '$lib/server/db';
import { upsertAnnotation, listAnnotationsForState } from '$lib/server/manualScreenStore';

type Bbox = { x: number; y: number; w: number; h: number };

function existingAnnotation(screenId: string, stateSlug: string, elementSlug: string) {
  return listAnnotationsForState(screenId, stateSlug).find((a) => a.element_slug === elementSlug) ?? null;
}

function parseOptionalStringArray(raw: unknown, field: string): string[] | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  if (!Array.isArray(raw)) throw error(400, `${field} must be an array of strings`);
  return raw.filter((s): s is string => typeof s === 'string' && s.length > 0);
}

function parseBboxIfPresent(raw: unknown): Bbox | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object') throw error(400, 'bbox must be an object');
  const r = raw as Record<string, unknown>;
  const x = Number(r.x), y = Number(r.y), w = Number(r.w), h = Number(r.h);
  if (![x, y, w, h].every(Number.isFinite)) throw error(400, 'bbox.{x,y,w,h} must be finite numbers');
  if (w <= 0 || h <= 0) throw error(400, 'bbox.w and bbox.h must be positive');
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

export const PATCH: RequestHandler = async ({ params, request }) => {
  const screenId = params.screenId ?? '';
  const stateSlug = params.stateSlug ?? '';
  const elementSlug = params.elementSlug ?? '';
  if (!screenId || !stateSlug || !elementSlug) throw error(400, 'screenId, stateSlug, elementSlug required');

  const current = existingAnnotation(screenId, stateSlug, elementSlug);
  if (!current) throw error(404, 'annotation not found');

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw error(400, 'JSON body required');

  const bbox = parseBboxIfPresent(body.bbox) ?? current.bbox;
  const itemName = typeof body.itemName === 'string' ? body.itemName.trim() : current.item_name;
  const cliVerbs = parseOptionalStringArray(body.cliVerbs, 'cliVerbs') ?? current.cli_verbs;
  const dataSources = parseOptionalStringArray(body.dataSources, 'dataSources') ?? current.data_sources;
  const intendedActions = parseOptionalStringArray(body.intendedActions, 'intendedActions') ?? current.intended_actions;
  const logicText = body.logicText === undefined ? current.logic_text : (typeof body.logicText === 'string' ? body.logicText : null);
  const tabOrder = typeof body.tabOrder === 'number' ? body.tabOrder : current.tab_order;

  const annotation = upsertAnnotation({
    screenId, stateSlug, elementSlug, itemName: itemName.length > 0 ? itemName : 'Untitled element',
    bbox, cliVerbs, dataSources, logicText, intendedActions, tabOrder
  });
  return json({ annotation });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const screenId = params.screenId ?? '';
  const stateSlug = params.stateSlug ?? '';
  const elementSlug = params.elementSlug ?? '';
  if (!screenId || !stateSlug || !elementSlug) throw error(400, 'screenId, stateSlug, elementSlug required');

  const result = getIdentityDb()
    .prepare(`DELETE FROM manual_element_annotations WHERE screen_id = ? AND state_slug = ? AND element_slug = ?`)
    .run(screenId, stateSlug, elementSlug);

  return json({ deleted: result.changes });
};
