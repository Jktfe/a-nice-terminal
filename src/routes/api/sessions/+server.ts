import { json } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { nanoid } from 'nanoid';

export function GET() {
  const sessions = queries.listSessions();
  return json(sessions);
}

export async function POST({ request }) {
  const { name, type, workspace_id, root_dir } = await request.json();
  const id = nanoid();
  queries.createSession(id, name, type, workspace_id || null, root_dir || null, '{}');
  const session = queries.getSession(id);
  return json(session, { status: 201 });
}
