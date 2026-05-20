/**
 * remoteRedeem — atomic admission-redeem-and-mint-mapping for the M4
 * Remote ANT redeem path.
 *
 * Lives in its own module (extracted per T2.5 cap fix on
 * remoteMappingStore.ts which crossed 200L when this orchestration
 * landed inline). Combines remoteAdmissionStore validation with
 * remoteMappingStore.createMapping inside a single db.transaction so a
 * wrong-code or replay-redeem call leaves zero mapping/terminal/
 * membership rows behind (per T2 B1 fix).
 *
 * Exports a single function `redeemAdmissionAndMintMapping` consumed by
 * the /api/remote-ant/admissions/[admissionId]/redeem route.
 */
import { hashToken } from './chatInviteStore';
import { getIdentityDb } from './db';
import type { LifetimePreset, StoredAdmission } from './remoteAdmissionStore';
import { createMapping, type CreateMappingResult, type MappingDirection } from './remoteMappingStore';

export type RedeemAndMintInput = {
  admissionId: string;
  code: string;
  remoteInstanceLabel: string;
  direction?: MappingDirection;
};

export function redeemAdmissionAndMintMapping(input: RedeemAndMintInput): CreateMappingResult | null {
  const db = getIdentityDb();
  return db.transaction((): CreateMappingResult | null => {
    const admRow = db.prepare(`SELECT * FROM chat_remote_admissions WHERE id = ?`)
      .get(input.admissionId) as Record<string, unknown> | undefined;
    if (!admRow) return null;
    const adm: StoredAdmission = {
      id: admRow.id as string,
      room_id: admRow.room_id as string,
      lifetime_preset: admRow.lifetime_preset as LifetimePreset,
      expires_at_ms: (admRow.expires_at_ms as number | null) ?? null,
      created_by_handle: (admRow.created_by_handle as string | null) ?? null,
      created_at_ms: admRow.created_at_ms as number,
      accepted_at_ms: (admRow.accepted_at_ms as number | null) ?? null,
      expires_acceptance_at_ms: admRow.expires_acceptance_at_ms as number,
      mapping_id_after_accept: (admRow.mapping_id_after_accept as string | null) ?? null,
      revoked_at_ms: (admRow.revoked_at_ms as number | null) ?? null
    };
    const now = Date.now();
    if (adm.revoked_at_ms !== null) return null;
    if (adm.accepted_at_ms !== null) return null;
    if (now > adm.expires_acceptance_at_ms) return null;
    if (hashToken(input.code) !== (admRow.code_hash as string)) return null;
    const result = createMapping({
      roomId: adm.room_id,
      remoteInstanceLabel: input.remoteInstanceLabel,
      admissionId: adm.id,
      lifetimePreset: adm.lifetime_preset,
      expiresAtMs: adm.expires_at_ms,
      direction: input.direction
    });
    db.prepare(`UPDATE chat_remote_admissions
      SET accepted_at_ms = ?, mapping_id_after_accept = ?
      WHERE id = ?`).run(now, result.mapping.id, adm.id);
    return result;
  })();
}
