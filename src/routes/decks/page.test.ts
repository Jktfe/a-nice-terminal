import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync('src/routes/decks/[deckId]/+page.svelte', 'utf8');

describe('/decks/[deckId] page source', () => {
  it('uses ElevenLabs explicitly for stage voice instead of browser fallback', () => {
    expect(pageSource).toContain("from '$lib/voice/interview-tts'");
    expect(pageSource).toContain('ElevenLabsTTSProvider');
    expect(pageSource).not.toContain('resolvePreferredProvider()');
    expect(pageSource).toContain('DeckViewerToolbar');
    expect(pageSource).toContain('onPlayPause={playCurrentSlide}');
    expect(pageSource).toContain('speakingThisSlide={speakingIndex === activeIndex}');
    expect(pageSource).toContain('pausedThisSlide={pausedIndex === activeIndex}');
  });

  it('passes password-protected deck access through to the Stage voice proxy', () => {
    expect(pageSource).toContain('deckId: deck.id');
    expect(pageSource).toContain('deckPassword: data.deckPassword ?? undefined');
  });

  it('stops slide narration when the active slide changes', () => {
    expect(pageSource).toContain('function clampedSet(next: number): void');
    expect(pageSource).toContain('stopSpeaking();');
    expect(pageSource).toContain('window.removeEventListener');
  });

  it('prefers speaker notes over visible slide text for narration', () => {
    expect(pageSource).toContain('speakerNotes');
    expect(pageSource).toContain('narration');
    expect(pageSource).toContain('getNarrationForSlide');
  });
});
