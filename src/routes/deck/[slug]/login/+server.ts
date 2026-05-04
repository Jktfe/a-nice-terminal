import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { readDeckMeta } from '$lib/server/decks';
import { issueDeckCookie, validateDeckInviteToken } from '$lib/server/deck-view-auth';
import { renderDeckLogin } from '$lib/server/deck-login-page';

function slugParam(event: RequestEvent): string {
  return String((event.params as Record<string, string>).slug ?? '');
}

export function GET(event: RequestEvent) {
  const slug = slugParam(event);
  const deck = readDeckMeta(slug);
  if (!deck) throw error(404, 'deck not found');
  return renderDeckLogin(slug);
}

export async function POST(event: RequestEvent) {
  const slug = slugParam(event);
  const deck = readDeckMeta(slug);
  if (!deck) throw error(404, 'deck not found');

  const form = await event.request.formData();
  const token = String(form.get('token') ?? '');
  const result = validateDeckInviteToken(slug, deck, token);
  if (!result.ok) {
    return renderDeckLogin(slug, { status: result.status, message: result.message });
  }
  issueDeckCookie(event.cookies, slug, result.tokenId, event.url);
  throw redirect(302, `/deck/${encodeURIComponent(slug)}/`);
}
