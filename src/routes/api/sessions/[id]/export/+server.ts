import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { exportSession, parseSessionExportFormat } from '$lib/server/sessionExportStore';

export function GET({ params, url }: RequestEvent<{ id: string }>) {
  const sessionId = params.id;
  if (!sessionId) throw error(400, 'session id is required.');

  let format;
  try {
    format = parseSessionExportFormat(url.searchParams.get('format'));
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'Unsupported export format.');
  }

  try {
    const exported = exportSession({ sessionId, format });
    return new Response(format === 'json' ? exported.body : exported.body, {
      headers: {
        'content-type': exported.contentType,
        'content-disposition': `attachment; filename="${exported.filename}"`
      }
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Could not export session.';
    if (message.startsWith('No session or room found')) throw error(404, message);
    throw cause;
  }
}
