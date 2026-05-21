/**
 * agentStatusHookAuth — hook-nonce mint + verify + rotate for the
 * M3.4a-v2 PUT /api/terminals/:id/agent-status route per contract Q4 +
 * Q7 + locked OQ #2 (PER-PUSH rotation).
 *
 * Bootstrap: the FIRST nonce is minted via installHookNonce(terminalId)
 * which writes hook_nonce_hash into terminals.meta (JSON column) and
 * returns the plaintext for the hook installer to capture. T3 hooks
 * install command will call this; T2 tests call it directly.
 *
 * Per push: the hook caller presents `nonce` in the body. The route
 * calls verifyAndRotateHookNonce(terminalId, presentedNonce) which:
 *   1. Loads terminals.meta.hook_nonce_hash
 *   2. timingSafeEqual against hashToken(presentedNonce)
 *   3. On match: mints new nonce, updates hook_nonce_hash, returns the
 *      new plaintext nonce so the caller can use it for the next push
 *   4. On mismatch / no nonce installed: returns null (caller maps 401)
 *
 * Storage: terminals.meta is a TEXT column with JSON content. We
 * read-modify-write the JSON object so other meta fields are preserved.
 */
import { hashToken, mintTokenSecret } from './chatInviteStore';
import { getIdentityDb } from './db';
import { timingSafeEqual } from 'crypto';

const HOOK_NONCE_KEY = 'hook_nonce_hash';

function readMeta(terminalId: string): { meta: Record<string, unknown>; exists: boolean } {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT meta FROM terminals WHERE id = ?`).get(terminalId) as
    { meta: string } | undefined;
  if (!row) return { meta: {}, exists: false };
  try {
    const parsed = JSON.parse(row.meta || '{}');
    return { meta: parsed && typeof parsed === 'object' ? parsed : {}, exists: true };
  } catch {
    return { meta: {}, exists: true };
  }
}

function writeMeta(terminalId: string, meta: Record<string, unknown>): void {
  const db = getIdentityDb();
  db.prepare(`UPDATE terminals SET meta = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(meta), Date.now(), terminalId);
}

export function installHookNonce(terminalId: string): string | null {
  const { meta, exists } = readMeta(terminalId);
  if (!exists) return null;
  const nonce = mintTokenSecret();
  meta[HOOK_NONCE_KEY] = hashToken(nonce);
  writeMeta(terminalId, meta);
  return nonce;
}

export function verifyAndRotateHookNonce(terminalId: string, presentedNonce: string): string | null {
  const { meta, exists } = readMeta(terminalId);
  if (!exists) return null;
  const storedHash = meta[HOOK_NONCE_KEY];
  if (typeof storedHash !== 'string' || storedHash.length === 0) return null;
  const presentedHash = hashToken(presentedNonce);
  const a = Buffer.from(presentedHash);
  const b = Buffer.from(storedHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const nextNonce = mintTokenSecret();
  meta[HOOK_NONCE_KEY] = hashToken(nextNonce);
  writeMeta(terminalId, meta);
  return nextNonce;
}
