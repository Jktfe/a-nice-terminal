import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type VoiceProvider = 'elevenlabs' | 'browser';

export type VoicePreset = {
  id: string;
  name: string;
  provider: VoiceProvider;
  voiceId: string;
  modelId: string | null;
  notes: string | null;
  sampleText: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

type VoicePresetRow = {
  id: string;
  name: string;
  provider: VoiceProvider;
  voice_id: string;
  model_id: string | null;
  notes: string | null;
  sample_text: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

function rowToPreset(row: VoicePresetRow): VoicePreset {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    voiceId: row.voice_id,
    modelId: row.model_id,
    notes: row.notes,
    sampleText: row.sample_text,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function assertProvider(provider: string): asserts provider is VoiceProvider {
  if (provider !== 'elevenlabs' && provider !== 'browser') {
    throw new Error('provider must be elevenlabs or browser.');
  }
}

export function saveVoicePreset(input: {
  id?: string | null;
  name: string;
  provider?: string | null;
  voiceId: string;
  modelId?: string | null;
  notes?: string | null;
  sampleText?: string | null;
  nowMs?: number;
}): VoicePreset {
  const id = cleanText(input.id) ?? randomUUID();
  const name = cleanText(input.name);
  if (!name) throw new Error('name is required.');
  const provider = cleanText(input.provider) ?? 'elevenlabs';
  assertProvider(provider);
  const voiceId = cleanText(input.voiceId);
  if (!voiceId) throw new Error('voiceId is required.');
  const modelId = cleanText(input.modelId);
  const notes = cleanText(input.notes);
  const sampleText = cleanText(input.sampleText);
  const nowMs = input.nowMs ?? Date.now();
  const existing = getVoicePreset(id);
  const createdAtMs = existing?.createdAtMs ?? nowMs;

  getIdentityDb().prepare(
    `INSERT INTO voice_presets
      (id, name, provider, voice_id, model_id, notes, sample_text, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       provider = excluded.provider,
       voice_id = excluded.voice_id,
       model_id = excluded.model_id,
       notes = excluded.notes,
       sample_text = excluded.sample_text,
       updated_at_ms = excluded.updated_at_ms`
  ).run(id, name, provider, voiceId, modelId, notes, sampleText, createdAtMs, nowMs);

  const saved = getVoicePreset(id);
  if (!saved) throw new Error('failed to save voice preset.');
  return saved;
}

export function getVoicePreset(id: string | null | undefined): VoicePreset | null {
  const cleanId = cleanText(id);
  if (!cleanId) return null;
  const row = getIdentityDb()
    .prepare(
      `SELECT id, name, provider, voice_id, model_id, notes, sample_text, created_at_ms, updated_at_ms
         FROM voice_presets
        WHERE id = ?`
    )
    .get(cleanId) as VoicePresetRow | undefined;
  return row ? rowToPreset(row) : null;
}

export function listVoicePresets(): VoicePreset[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT id, name, provider, voice_id, model_id, notes, sample_text, created_at_ms, updated_at_ms
         FROM voice_presets
        ORDER BY name COLLATE NOCASE ASC, created_at_ms ASC`
    )
    .all() as VoicePresetRow[];
  return rows.map(rowToPreset);
}

export function resetVoicePresetStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM voice_presets`).run();
}
