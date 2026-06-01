import { beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from './db';
import {
  getVoicePreset,
  listVoicePresets,
  resetVoicePresetStoreForTests,
  saveVoicePreset
} from './voicePresetStore';

describe('voicePresetStore', () => {
  beforeEach(() => {
    resetIdentityDbForTests();
    resetVoicePresetStoreForTests();
  });

  it('saves a human-named ElevenLabs voice preset for future deck reuse', () => {
    const preset = saveVoicePreset({
      id: 'xeno-demo',
      name: 'Xeno demo voice',
      provider: 'elevenlabs',
      voiceId: 'wADoNOIls814sWSl7P4V',
      modelId: 'eleven_turbo_v2_5',
      notes: 'Board-demo voice',
      sampleText: 'Welcome to the Xeno board deck.',
      nowMs: 1234
    });

    expect(preset).toMatchObject({
      id: 'xeno-demo',
      name: 'Xeno demo voice',
      provider: 'elevenlabs',
      voiceId: 'wADoNOIls814sWSl7P4V',
      modelId: 'eleven_turbo_v2_5',
      notes: 'Board-demo voice',
      sampleText: 'Welcome to the Xeno board deck.',
      createdAtMs: 1234,
      updatedAtMs: 1234
    });
    expect(getVoicePreset('xeno-demo')).toEqual(preset);
  });

  it('updates an existing preset without changing its stable id', () => {
    saveVoicePreset({
      id: 'stage-default',
      name: 'Old name',
      provider: 'elevenlabs',
      voiceId: 'voice-old',
      nowMs: 100
    });

    const updated = saveVoicePreset({
      id: 'stage-default',
      name: 'Better voice',
      provider: 'elevenlabs',
      voiceId: 'voice-new',
      modelId: 'model-new',
      nowMs: 200
    });

    expect(updated.createdAtMs).toBe(100);
    expect(updated.updatedAtMs).toBe(200);
    expect(updated.name).toBe('Better voice');
    expect(updated.voiceId).toBe('voice-new');
    expect(listVoicePresets()).toHaveLength(1);
  });

  it('rejects blank names and voice ids', () => {
    expect(() => saveVoicePreset({
      name: ' ',
      provider: 'elevenlabs',
      voiceId: 'voice'
    })).toThrow('name is required');

    expect(() => saveVoicePreset({
      name: 'Voice',
      provider: 'elevenlabs',
      voiceId: ' '
    })).toThrow('voiceId is required');
  });
});
