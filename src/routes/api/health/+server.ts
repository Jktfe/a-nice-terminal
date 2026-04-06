import { json } from '@sveltejs/kit';
export function GET() {
  return json({ status: 'ok', version: '3.0.0-alpha' });
}
