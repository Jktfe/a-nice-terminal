import { json } from '@sveltejs/kit';

export function DELETE() {
  return json({ ok: false, error: 'Static deck comments are not available here.' }, { status: 403 });
}
