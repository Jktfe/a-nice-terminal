// POST /api/manual/states/:screenId/:stateSlug/annotations
// Author-mode endpoint (slice 1.5, JWPK msg_iu0yjpat78 2026-05-23):
// create a new annotation by dragging on the canvas. Workspace-public
// (same as read scope); slice 6 audit-log will record the author.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  upsertAnnotation,
  getScreenState,
  recordAnnotationAudit,
  findAnnotationByKeys
} from '$lib/server/manualScreenStore';
import { canonicaliseOperatorHandle, getOperatorHandle } from '$lib/server/operatorHandle';

type Bbox = { x: number; y: number; w: number; h: number };

function parseBbox(raw: unknown): Bbox {
  if (!raw || typeof raw !== 'object') throw error(400, 'bbox required');
  const r = raw as Record<string, unknown>;
  const x = Number(r.x), y = Number(r.y), w = Number(r.w), h = Number(r.h);
  if (![x, y, w, h].every(Number.isFinite)) throw error(400, 'bbox.{x,y,w,h} must be finite numbers');
  if (w <= 0 || h <= 0) throw error(400, 'bbox.w and bbox.h must be positive');
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function parseStringArray(raw: unknown, field: string): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw error(400, `${field} must be an array of strings`);
  return raw.filter((s): s is string => typeof s === 'string' && s.length > 0);
}

export const POST: RequestHandler = async ({ params, request }) => {
  const screenId = params.screenId ?? '';
  const stateSlug = params.stateSlug ?? '';
  if (!screenId || !stateSlug) throw error(400, 'screenId and stateSlug required');
  if (!getScreenState(screenId, stateSlug)) throw error(404, 'state not found');

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw error(400, 'JSON body required');

  const elementSlug = typeof body.elementSlug === 'string' && body.elementSlug.trim().length > 0
    ? body.elementSlug.trim()
    : `el-${Date.now().toString(36)}`;
  const itemName = typeof body.itemName === 'string' && body.itemName.trim().length > 0
    ? body.itemName.trim()
    : 'Untitled element';
  const bbox = parseBbox(body.bbox);
  const cliVerbs = parseStringArray(body.cliVerbs, 'cliVerbs');
  const dataSources = parseStringArray(body.dataSources, 'dataSources');
  const intendedActions = parseStringArray(body.intendedActions, 'intendedActions');
  const logicText = typeof body.logicText === 'string' ? body.logicText : null;
  const tabOrder = typeof body.tabOrder === 'number' ? body.tabOrder : 999;

  const before = findAnnotationByKeys(screenId, stateSlug, elementSlug);
  const annotation = upsertAnnotation({
    screenId, stateSlug, elementSlug, itemName, bbox,
    cliVerbs, dataSources, logicText, intendedActions, tabOrder
  });
  // Slice 6 audit-log: stamp this edit. POST is create-or-update — the
  // action discriminates so the Audit view can render the first-create
  // entry distinctly from subsequent updates.
  recordAnnotationAudit({
    screenId, stateSlug, elementSlug,
    editedByHandle: typeof body.editedByHandle === 'string' && body.editedByHandle.length > 0
      ? canonicaliseOperatorHandle(body.editedByHandle) : getOperatorHandle(),
    action: before === null ? 'create' : 'update',
    before,
    after: annotation
  });
  return json({ annotation }, { status: 201 });
};
