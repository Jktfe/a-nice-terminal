import { json } from '@sveltejs/kit';

export function GET() {
  return json({ design: null, exists: false, warning: null });
}

export function PUT() {
  return json({ ok: false, error: 'Static deck design editing is not available here.' }, { status: 403 });
}

export function DELETE() {
  return json({ ok: false, error: 'Static deck design editing is not available here.' }, { status: 403 });
}
