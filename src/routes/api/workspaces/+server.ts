import { json } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { nanoid } from 'nanoid';

export function GET() {
  const workspaces = queries.listWorkspaces();
  return json(workspaces);
}

export async function POST({ request }) {
  const { name, root_dir } = await request.json();
  const id = nanoid();
  queries.createWorkspace(id, name, root_dir || null);
  return json({ id, name, root_dir }, { status: 201 });
}
