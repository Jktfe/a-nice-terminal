import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { nanoid } from 'nanoid';

export function GET() {
  const workspaces = queries.listWorkspaces();
  return json(workspaces);
}

export async function POST({ request }: RequestEvent) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return json({ error: 'name is required' }, { status: 400 });

  const root_dir = typeof body?.root_dir === 'string' && body.root_dir.trim()
    ? body.root_dir.trim()
    : null;
  const id = nanoid();
  queries.createWorkspace(id, name, root_dir);
  return json({ id, name, root_dir }, { status: 201 });
}
