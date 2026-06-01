import type { RoomDeck } from './deckStore';
import { getVoicePreset, type VoicePreset } from './voicePresetStore';

export type PublicVoicePreset = Pick<VoicePreset, 'id' | 'name' | 'provider' | 'voiceId' | 'modelId' | 'notes' | 'sampleText'>;

export type PublicRoomDeck = Omit<RoomDeck, 'accessPassword'> & {
  voicePreset: PublicVoicePreset | null;
};

export function serializeDeckForApi(deck: RoomDeck): PublicRoomDeck {
  const { accessPassword: _accessPassword, ...publicDeck } = deck;
  const preset = getVoicePreset(deck.voicePresetId);
  return {
    ...publicDeck,
    voicePreset: preset
      ? {
          id: preset.id,
          name: preset.name,
          provider: preset.provider,
          voiceId: preset.voiceId,
          modelId: preset.modelId,
          notes: preset.notes,
          sampleText: preset.sampleText
        }
      : null
  };
}
