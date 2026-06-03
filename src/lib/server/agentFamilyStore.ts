/**
 * Owner-family access projection.
 *
 * Durable schema:
 *   owners/owner_handles = user handles
 *   agent_handles        = agent handle -> owner_id
 *
 * The static projection is a P0 bridge for the currently seeded New Model
 * handles while accounts-owned org handle bindings land.
 */

import { getIdentityDb } from './db';

const STATIC_FAMILIES: string[][] = [
  ['@JWPK', '@jamesK', '@james', '@antchatmacdev', '@antmacdevcodex', '@serverlaptop'],
  ['@mark'],
  ['@stevo', '@jstephenson'],
  ['@jamesm5'],
  ['@marco'],
  ['@adelle'],
  ['@matt']
];

function normaliseHandle(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function unique(handles: string[]): string[] {
  return [...new Set(handles.map(normaliseHandle).filter((handle) => handle.length > 0))];
}

function staticFamilyForHandle(handle: string): string[] {
  const normalised = normaliseHandle(handle);
  return STATIC_FAMILIES.find((family) => family.includes(normalised)) ?? [normalised];
}

function ownerIdForHandle(handle: string): string | null {
  const normalised = normaliseHandle(handle);
  const userRow = getIdentityDb()
    .prepare(`SELECT owner_id FROM owner_handles WHERE handle = ?`)
    .get(normalised) as { owner_id: string } | undefined;
  if (userRow) return userRow.owner_id;

  const agentRow = getIdentityDb()
    .prepare(`SELECT owner_id FROM agent_handles WHERE handle = ?`)
    .get(normalised) as { owner_id: string } | undefined;
  return agentRow?.owner_id ?? null;
}

function dbFamilyForOwner(ownerId: string): string[] {
  const userHandles = getIdentityDb()
    .prepare(`SELECT handle FROM owner_handles WHERE owner_id = ?`)
    .all(ownerId) as { handle: string }[];
  const agentHandles = getIdentityDb()
    .prepare(`SELECT handle FROM agent_handles WHERE owner_id = ?`)
    .all(ownerId) as { handle: string }[];
  return unique([
    ...userHandles.map((row) => row.handle),
    ...agentHandles.map((row) => row.handle)
  ]);
}

export function familyHandlesForPrincipal(handle: string): string[] {
  const normalised = normaliseHandle(handle);
  const ownerId = ownerIdForHandle(normalised);
  if (ownerId) {
    const dbFamily = dbFamilyForOwner(ownerId);
    if (dbFamily.length > 0) return dbFamily;
  }
  return staticFamilyForHandle(normalised);
}

export function expandHandlesToOwnerFamilies(handles: string[]): string[] {
  return unique(handles.flatMap((handle) => familyHandlesForPrincipal(handle)));
}
