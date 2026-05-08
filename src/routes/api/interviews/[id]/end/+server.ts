import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';
import { assertCanWrite, assertSameRoom } from '$lib/server/room-scope.js';
import { loadInterviewBundle, mergeInterviewMeta } from '$lib/server/interviews.js';
import { routeInterviewSummaryRequest } from '$lib/server/interview-routing.js';

export async function POST(event: RequestEvent<{ id: string }>) {
  assertCanWrite(event);

  const interview = queries.getInterview(event.params.id) as any;
  if (!interview) return json({ error: 'interview not found' }, { status: 404 });
  assertSameRoom(event, interview.room_id);

  const body = await event.request.json().catch(() => ({})) as Record<string, unknown>;
  const transcriptRef = typeof body.transcript_ref === 'string' && body.transcript_ref.trim() ? body.transcript_ref.trim() : null;
  const transcriptPath = typeof body.transcript_path === 'string' && body.transcript_path.trim() ? body.transcript_path.trim() : null;
  const summaryMessageId = typeof body.summary_message_id === 'string' && body.summary_message_id.trim() ? body.summary_message_id.trim() : null;
  const summaryStatus = typeof body.summary_status === 'string' && body.summary_status.trim()
    ? body.summary_status.trim()
    : summaryMessageId ? 'posted' : 'requested';

  if (summaryMessageId) {
    const summary = queries.getMessage(summaryMessageId) as any;
    if (!summary || summary.session_id !== interview.room_id) {
      return json({ error: 'summary_message_id must reference a message in the interview room' }, { status: 400 });
    }
  }

  const meta = mergeInterviewMeta(interview.meta, body.meta);
  queries.finishInterview(interview.id, transcriptRef, transcriptPath, summaryMessageId, summaryStatus, meta);

  const bundle = loadInterviewBundle(interview.id);
  const summaryDeliveries = summaryMessageId || !bundle?.interview
    ? []
    : await routeInterviewSummaryRequest(bundle.interview);
  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(interview.room_id, { type: 'interview_ended', interview: bundle?.interview, summary_deliveries: summaryDeliveries });

  return json({ ...bundle, summary_deliveries: summaryDeliveries });
}
