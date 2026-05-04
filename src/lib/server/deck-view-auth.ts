import { createHmac, timingSafeEqual } from 'crypto';
import type { Cookies } from '@sveltejs/kit';
import { queries } from './db.js';
import { resolveToken, type InviteRow, type TokenRow } from './room-invites.js';
import type { DeckMeta } from './decks.js';

const COOKIE_TTL_MS = 12 * 60 * 60 * 1000;

function cookieSecret(): string {
  const secret = process.env.ANT_DECK_COOKIE_SECRET || process.env.ANT_API_KEY;
  if (!secret) throw new Error('ANT_API_KEY or ANT_DECK_COOKIE_SECRET required for deck viewer cookies');
  return secret;
}

function sign(payload: string): string {
  return createHmac('sha256', cookieSecret()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function deckCookieName(slug: string): string {
  return `ant-deck-${slug.replace(/[^A-Za-z0-9._-]/g, '-')}`;
}

export function createDeckCookie(slug: string, tokenId: string, now = Date.now()): { value: string; expiresAtMs: number } {
  const expiresAtMs = now + COOKIE_TTL_MS;
  const payload = `${slug}:${tokenId}:${expiresAtMs}`;
  return {
    value: `${tokenId}.${expiresAtMs}.${sign(payload)}`,
    expiresAtMs,
  };
}

function tokenStillValid(tokenId: string, deck: DeckMeta): boolean {
  const token = queries.getRoomToken(tokenId) as TokenRow | undefined;
  if (!token || token.revoked_at) return false;
  if (!deck.allowed_room_ids.includes(token.room_id)) return false;
  const invite = queries.getRoomInvite(token.invite_id) as InviteRow | undefined;
  return Boolean(invite && !invite.revoked_at);
}

export function verifyDeckCookieValue(slug: string, deck: DeckMeta, value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const [tokenId, expiresRaw, signature] = value.split('.');
  const expiresAtMs = Number(expiresRaw);
  if (!tokenId || !signature || !Number.isFinite(expiresAtMs) || expiresAtMs <= now) return false;
  const payload = `${slug}:${tokenId}:${expiresAtMs}`;
  if (!safeEqual(signature, sign(payload))) return false;
  return tokenStillValid(tokenId, deck);
}

export function hasDeckCookie(cookies: Cookies, slug: string, deck: DeckMeta): boolean {
  return verifyDeckCookieValue(slug, deck, cookies.get(deckCookieName(slug)));
}

export function issueDeckCookie(cookies: Cookies, slug: string, tokenId: string, url: URL): void {
  const cookie = createDeckCookie(slug, tokenId);
  cookies.set(deckCookieName(slug), cookie.value, {
    path: `/deck/${slug}`,
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'lax',
    expires: new Date(cookie.expiresAtMs),
  });
}

export function validateDeckInviteToken(slug: string, deck: DeckMeta, token: string): { ok: true; tokenId: string } | { ok: false; status: 401 | 403; message: string } {
  const resolved = resolveToken(token);
  if (!resolved) {
    return { ok: false, status: 401, message: 'Invalid, expired, or revoked invite token.' };
  }
  if (!deck.allowed_room_ids.includes(resolved.token.room_id)) {
    return { ok: false, status: 403, message: 'This room token is not authorised for this deck.' };
  }
  return { ok: true, tokenId: resolved.token.id };
}
