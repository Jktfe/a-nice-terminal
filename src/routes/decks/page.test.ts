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

  it('wraps external deck substrates in the Stage viewer when the deck theme carries a source slug', () => {
    expect(pageSource).toContain("from '$lib/externalDeckSubstrate'");
    expect(pageSource).toContain('externalDeckSourceFromTheme(deck.theme)');
    expect(pageSource).toContain('src={externalDeckSource.path}');
  });

  it('lets presenters compose accepted alternatives into the active Stage path', () => {
    expect(pageSource).toContain('type StageAlternativeDecisionAction');
    expect(pageSource).toContain('composedSlides');
    expect(pageSource).toContain('/alternatives/decision');
    expect(pageSource).toContain('focusComposedAlternative');
    expect(pageSource).toContain('Replace');
    expect(pageSource).toContain('Append after');
    expect(pageSource).toContain('Appendix');
    expect(pageSource).toContain('Park');
  });

  it('moves presenter focus to generated or adopted slide alternatives', () => {
    expect(pageSource).toContain('newestSlideAlternativeForSource(feedbackSlideIndex)');
    expect(pageSource).toContain("action === 'replace-slide' || action === 'append-after' || action === 'append-appendix'");
    expect(pageSource).toContain('candidate.sourceAlternativeRef === alternativeRef');
    expect(pageSource).toContain('Using adopted alternative in the main deck path.');
    expect(pageSource).toContain('activeVersionRef');
    expect(pageSource).toContain('originalVersionIsActive');
  });

  it('renders the Stage cockpit controls from the wireframe', () => {
    expect(pageSource).toContain('stage-command-strip');
    expect(pageSource).toContain('assets-menu');
    expect(pageSource).toContain('stage-cockpit');
    expect(pageSource).toContain('version-history-panel');
    expect(pageSource).toContain('slide-picker-grid');
    expect(pageSource).toContain('Slide picker');
    expect(pageSource).toContain('Hide');
    expect(pageSource).toContain('Delete');
    expect(pageSource).toContain('Move');
  });

  it('uses stable claim anchors for the Stage validation overlay', () => {
    expect(pageSource).toContain('function claimAnchorForSlideClaim');
    expect(pageSource).toContain('id: claimAnchorForSlideClaim(activeSlide, n, cleaned)');
    expect(pageSource).toContain('claimAnchor: claim.id');
    expect(pageSource).toContain('claimAnchor={selectedClaimForOverlay.claimAnchor}');
    expect(pageSource).toContain('Click a claim to inspect its verifier runs.');
  });

  it('renders Stage proposal refs through the safe link allowlist', () => {
    expect(pageSource).toContain("from '$lib/chat/trackerRefs'");
    expect(pageSource).toContain('safeUrlForTrackerLink(alternative.ref)');
    expect(pageSource).toContain('href={safeAlternativeHref}');
    expect(pageSource).not.toContain('href={alternative.ref}');
  });
});
