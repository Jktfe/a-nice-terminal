// M3 #3 — Session-scoped consent grants API
//
// GET  /api/sessions/:id/grants?granted_to=@handle&status=active&topic=file-read
// POST /api/sessions/:id/grants  { topic, granted_to, source_set?, duration?, max_answers? }

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { nanoid } from 'nanoid';
import { assertSameRoom, assertCanWrite } from '$lib/server/room-scope';
import { buildConsentGrant } from '$lib/server/consent/grant-scope.js';

export function GET(event: RequestEvent<{ id: string }>) {
  assertSameRoom(event, event.params.id);
  const url = event.url;
  const grantedTo = url.searchParams.get('granted_to');
  const status = url.searchParams.get('status');
  const topic = url.searchParams.get('topic');

  let grants: any[];
  if (grantedTo) {
    grants = queries.listConsentGrantsByGrantee(grantedTo);
    // Filter to session scope
    grants = grants.filter((g: any) => g.session_id === event.params.id);
  } else {
    grants = queries.listConsentGrants(event.params.id);
  }

  if (status) {
    grants = grants.filter((g: any) => g.status === status);
  }
  if (topic) {
    grants = grants.filter((g: any) => g.topic === topic);
  }

  const result = grants.map((g: any) => ({
    ...g,
    source_set: typeof g.source_set === 'string' ? JSON.parse(g.source_set) : g.source_set,
  }));

  return json({ grants: result });
}

export async function POST(event: RequestEvent<{ id: string }>) {
  assertSameRoom(event, event.params.id);
  assertCanWrite(event);
  const body = await event.request.json();

  const topic = String(body.topic || '').trim();
  const grantedTo = String(body.granted_to || '').trim();
  if (!topic) return json({ error: 'topic is required' }, { status: 400 });
  if (!grantedTo) return json({ error: 'granted_to is required' }, { status: 400 });

  const sourceSet = Array.isArray(body.source_set) ? body.source_set.filter((s: any) => typeof s === 'string') : [];
  const duration = String(body.duration || '1h');
  const maxAnswers = body.max_answers != null ? Number(body.max_answers) : null;

  const grant = buildConsentGrant({
    id: `cg_${nanoid(10)}`,
    sessionId: event.params.id,
    grantedTo: grantedTo.startsWith('@') ? grantedTo : `@${grantedTo}`,
    topic,
    sourceSet,
    duration,
    maxAnswers,
    nowMs: Date.now(),
  });

  queries.createConsentGrant(
    grant.id,
    grant.session_id,
    grant.granted_to,
    grant.topic,
    JSON.stringify(grant.source_set),
    grant.duration,
    grant.answer_count,
    grant.max_answers,
    grant.status,
    grant.granted_at_ms,
    grant.expires_at_ms,
    grant.meta,
  );

  const created = queries.getConsentGrant(grant.id);
  return json({
    grant: {
      ...created,
      source_set: typeof created.source_set === 'string' ? JSON.parse(created.source_set) : created.source_set,
    },
  }, { status: 201 });
}
