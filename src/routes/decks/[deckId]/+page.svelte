<!--
  /decks/[deckId] — shareable deck viewer.

  JWPK ask: "create a shared deck that presents how decks are presented,
  inspectable and shareable — I want to create shareable skills with
  examples for agents."

  Renders the slides one at a time with a slide-counter, prev/next
  buttons, and ←/→ keyboard navigation. The Inspect toggle shows the
  raw slide JSON for agents who want to read the deck programmatically.
  The Share button copies the canonical URL to the clipboard.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import DeckViewerToolbar from '$lib/components/DeckViewerToolbar.svelte';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import StageFeedbackPanel from '$lib/components/StageFeedbackPanel.svelte';
  import { renderMarkdown } from '$lib/chat/renderMarkdown';
  import { BrowserTTSProvider, ElevenLabsTTSProvider, type TTSHandle, type TTSProvider } from '$lib/voice/interview-tts';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  type DeckSlide = PageData['deck']['slides'][number];

  let activeIndex = $state(0);
  let inspectMode = $state(false);
  let shareNotice = $state('');
  let lastPublishedFocusRef = '';
  let speakingIndex = $state<number | null>(null);
  let pausedIndex = $state<number | null>(null);
  let voiceNotice = $state('');
  // Stage Validation UX (JWPK feedback msg_pub8alsnxf 2026-05-24 + screenshot):
  // when toggle ON, render a lens dropdown + visible "Claim N" numbering on
  // each paragraph/bullet in slide content. Click-to-overlay is a follow-up
  // slice; v1 ships the toggle + lens selection + visual numbering.
  let showValidation = $state(false);
  let activeLensId = $state<string | null>(null);
  let lenses = $state<{ id: string; name: string }[]>([]);

  async function loadLenses(): Promise<void> {
    if (lenses.length > 0) return;
    try {
      // scope=public lets the deck viewer pull lenses without admin bearer
      // (matches the deck-password presenter access pattern from 2b129fc).
      const res = await fetch('/api/validation-schemas?scope=public');
      if (!res.ok) return;
      const data = await res.json();
      const schemas: Array<{ id: string; name: string }> = data.schemas ?? [];
      lenses = schemas.map((s) => ({ id: s.id, name: s.name }));
      if (activeLensId === null && lenses.length > 0) activeLensId = lenses[0].id;
    } catch {
      /* deck still renders without validation */
    }
  }

  function toggleValidation(): void {
    showValidation = !showValidation;
    if (showValidation) void loadLenses();
  }
  let voiceSettings = $state<{
    provider: 'elevenlabs' | 'browser' | 'off';
    autoplay: boolean;
    elevenLabsAvailable: boolean;
    voiceId?: string;
  }>({ provider: 'elevenlabs', autoplay: true, elevenLabsAvailable: false });
  let currentTTSHandle: TTSHandle | null = null;
  let currentProvider: TTSProvider | null = null;

  // β + γ1 — feedback panel + local pause-context capture.
  // Per JWPK stage-live-edit-spec (codex-amended): when TTS pauses, snapshot
  // slide id + narration text + best-effort elapsed seconds + estimated
  // last-spoken text window. UI-local state only — no room broadcast yet
  // (that's γ2), no agent processing (that's ε), no artefact mutation.
  // Approximate speaking rate used to derive last-spoken-window (chars/sec).
  const APPROX_CHARS_PER_SEC = 16;
  type PauseSnapshot = {
    slideIndex: number;
    slideId: string;
    slideTitle: string;
    narrationText: string;
    elapsedMs: number;
    estimatedCharOffset: number;
    lastSpokenWindow: string;
    capturedAtMs: number;
  };
  type StageAlternativeOption =
    | {
        kind: 'proposal';
        slideIndex: number;
        taskId: string;
        ref: string;
        label: string;
        lens: string | null;
        summary: string | null;
        createdAtMs: number;
      }
    | {
        kind: 'slide';
        slideIndex: number;
        eventId: string;
        ref: string;
        label: string;
        originalTitle: string | null;
        proposedTitle: string;
        proposedContent: string;
        proposedSpeakerNotes: string;
        rationale: string;
        createdAtMs: number;
      };
  let pauseSnapshot = $state<PauseSnapshot | null>(null);
  let feedbackText = $state('');
  let pasteContext = $state('');
  let pauseContextRef = $state('');
  let feedbackSubmitting = $state(false);
  let feedbackNotice = $state<{ kind: 'ok' | 'err'; text: string; ref?: string } | null>(null);
  let stageAlternatives = $state<StageAlternativeOption[]>([]);
  let showAlternatives = $state(false);
  let selectedAlternativeRef = $state('');
  let speakStartMs = 0;

  const deck = $derived(data.deck);
  const deckPasswordQuery = $derived(data.deckPassword ? `?password=${encodeURIComponent(data.deckPassword)}` : '');
  const slides = $derived(deck.slides ?? []);
  const slideCount = $derived(slides.length);
  const activeSlide = $derived(slides[activeIndex]);
  const activeAlternatives = $derived(
    stageAlternatives.filter((alt) => alt.slideIndex === activeIndex)
  );
  const selectedAlternative = $derived(
    activeAlternatives.find((alt) => alt.ref === selectedAlternativeRef) ?? activeAlternatives[0] ?? null
  );
  const visibleSlideAlternative = $derived(
    showAlternatives && selectedAlternative?.kind === 'slide' ? selectedAlternative : null
  );
  const displayedSlideTitle = $derived(
    visibleSlideAlternative ? visibleSlideAlternative.proposedTitle : (activeSlide?.title ?? '')
  );
  const displayedSlideContent = $derived(
    visibleSlideAlternative ? visibleSlideAlternative.proposedContent : (activeSlide?.content ?? '')
  );
  const renderedBody = $derived(displayedSlideContent ? renderMarkdown(displayedSlideContent) : '');

  // Extract claim candidates from the current slide's markdown body.
  // v1 heuristic: each non-empty bullet or paragraph is a candidate claim.
  // The real claim-extractor (validationMarkdownExtractor.ts) operates on
  // committed artefacts; we mirror its shape here for live deck preview so
  // the Stage Validation UX can render numbered claims without a server
  // round-trip per slide.
  const slideClaims = $derived.by<{ index: number; text: string }[]>(() => {
    if (!activeSlide) return [];
    // Use displayedSlideContent so when an alternative slide is being viewed
    // (visibleSlideAlternative ≠ null), claim extraction reflects THAT
    // slide's content rather than the original. Keeps validation honest
    // when the presenter is toggling between original and Version B.
    const lines = displayedSlideContent.split('\n');
    const out: { index: number; text: string }[] = [];
    let inFence = false;
    let n = 0;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('```') || line.startsWith('~~~')) {
        inFence = !inFence;
        continue;
      }
      if (inFence || line.length === 0) continue;
      if (/^#{1,6}\s/.test(line)) continue;
      // Strip bullet/list marker
      const cleaned = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();
      if (cleaned.length === 0) continue;
      n += 1;
      out.push({ index: n, text: cleaned });
    }
    return out;
  });

  function clampedSet(next: number): void {
    if (slideCount === 0) return;
    const clamped = Math.max(0, Math.min(slideCount - 1, next));
    stopSpeaking();
    showAlternatives = false;
    selectedAlternativeRef = '';
    activeIndex = clamped;
    void publishStageFocus(clamped);
    if (voiceSettings.autoplay) void playCurrentSlide();
  }

  function next(): void { clampedSet(activeIndex + 1); }
  function prev(): void { clampedSet(activeIndex - 1); }

  function handleKey(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
      event.preventDefault();
      next();
    } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      event.preventDefault();
      prev();
    } else if (event.key === 'i' || event.key === 'I') {
      inspectMode = !inspectMode;
    }
  }

  function stopSpeaking(): void {
    currentTTSHandle?.cancel();
    currentTTSHandle = null;
    speakingIndex = null;
    pausedIndex = null;
  }

  function getNarrationForSlide(slide: DeckSlide | undefined): string {
    if (!slide) return '';
    return (slide.speakerNotes ?? slide.narration ?? slide.content ?? '').trim();
  }

  async function loadVoiceSettings(): Promise<void> {
    try {
      const response = await fetch('/api/voice/elevenlabs');
      if (!response.ok) return;
      const settings = await response.json() as {
        available?: boolean;
        stage_provider?: string;
        stage_autoplay?: boolean;
        default_voice_id?: string;
      };
      const provider = settings.stage_provider === 'browser' || settings.stage_provider === 'off'
        ? settings.stage_provider
        : 'elevenlabs';
      voiceSettings = {
        provider,
        autoplay: settings.stage_autoplay !== false,
        elevenLabsAvailable: settings.available === true,
        voiceId: typeof settings.default_voice_id === 'string' ? settings.default_voice_id : undefined
      };
    } catch {
      voiceNotice = 'Could not load Stage voice settings.';
    }
  }

  async function refreshStageAlternatives(): Promise<void> {
    try {
      const response = await fetch(`/api/decks/${encodeURIComponent(deck.id)}/alternatives${deckPasswordQuery}`);
      if (!response.ok) return;
      const body = await response.json() as { alternatives?: StageAlternativeOption[] };
      stageAlternatives = Array.isArray(body.alternatives) ? body.alternatives : [];
    } catch {
      // Alternatives are additive. A failed read should not block the deck.
    }
  }

  async function resolveStageProvider(): Promise<TTSProvider | null> {
    if (voiceSettings.provider === 'off') {
      voiceNotice = 'Stage voice is turned off in settings.';
      return null;
    }
    if (voiceSettings.provider === 'browser') {
      currentProvider = currentProvider?.name === 'browser' ? currentProvider : new BrowserTTSProvider();
      voiceNotice = 'Using browser voice because Stage voice provider is set to browser.';
      return currentProvider;
    }
    currentProvider = currentProvider?.name === 'elevenlabs' ? currentProvider : new ElevenLabsTTSProvider();
    if (!voiceSettings.elevenLabsAvailable && !(await currentProvider.available())) {
      voiceNotice = 'ElevenLabs is not configured on this server.';
      return null;
    }
    voiceNotice = 'Using ElevenLabs Stage voice.';
    return currentProvider;
  }

  function detectNarrationSource(slide: DeckSlide | undefined): 'narration' | 'speakerNotes' | 'content' {
    if (!slide) return 'content';
    const slideAny = slide as { narration?: string; speakerNotes?: string };
    if (typeof slideAny.speakerNotes === 'string' && slideAny.speakerNotes.trim().length > 0) return 'speakerNotes';
    if (typeof slideAny.narration === 'string' && slideAny.narration.trim().length > 0) return 'narration';
    return 'content';
  }

  function capturePauseSnapshot(): void {
    if (!activeSlide || speakingIndex === null) return;
    const narration = getNarrationForSlide(activeSlide);
    if (narration.length === 0) return;
    const elapsedMs = speakStartMs > 0 ? Date.now() - speakStartMs : 0;
    const elapsedSec = elapsedMs / 1000;
    const estimatedCharOffset = Math.min(
      Math.floor(elapsedSec * APPROX_CHARS_PER_SEC),
      narration.length
    );
    const windowStart = Math.max(0, estimatedCharOffset - 120);
    const lastSpokenWindow = narration.slice(windowStart, estimatedCharOffset);
    pauseSnapshot = {
      slideIndex: activeIndex,
      slideId: activeSlide.id,
      slideTitle: activeSlide.title,
      narrationText: narration,
      elapsedMs,
      estimatedCharOffset,
      lastSpokenWindow,
      capturedAtMs: Date.now()
    };
    // γ2: persist + broadcast to the room so subscribed agents can act.
    // Best-effort — UI capture (γ1) already succeeded; if the network
    // POST fails, surface a notice but don't clear the local snapshot.
    void persistPauseContext();
  }

  async function persistPauseContext(): Promise<void> {
    if (!pauseSnapshot || !activeSlide) return;
    try {
      const response = await fetch(
        `/api/decks/${encodeURIComponent(deck.id)}/stage-pause-context${deckPasswordQuery}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            slideId: pauseSnapshot.slideId,
            slideIndex: pauseSnapshot.slideIndex,
            narrationSource: detectNarrationSource(activeSlide),
            pausedAtMs: pauseSnapshot.capturedAtMs,
            estimatedCharOffset: pauseSnapshot.estimatedCharOffset,
            spokenWindow: pauseSnapshot.lastSpokenWindow
          })
        }
      );
      if (!response.ok) {
        voiceNotice = `Pause context broadcast failed (HTTP ${response.status}).`;
        pauseContextRef = '';
        return;
      }
      const body = await response.json() as { pause_context?: { ref?: string } };
      pauseContextRef = typeof body.pause_context?.ref === 'string' ? body.pause_context.ref : '';
    } catch {
      voiceNotice = 'Pause context broadcast failed (network).';
      pauseContextRef = '';
    }
  }

  async function submitFeedback(): Promise<void> {
    if (!pauseSnapshot || !activeSlide || feedbackText.trim().length === 0 || feedbackSubmitting) return;
    feedbackSubmitting = true;
    feedbackNotice = null;
    try {
      const response = await fetch(`/api/decks/${encodeURIComponent(deck.id)}/stage-feedback${deckPasswordQuery}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slideIndex: pauseSnapshot.slideIndex,
          feedbackText,
          pasteContext,
          pauseContextRef
        })
      });
      if (!response.ok) {
        feedbackNotice = { kind: 'err', text: `Feedback submit failed (HTTP ${response.status}).` };
        return;
      }
      const body = await response.json() as { proposal?: { ref?: string } };
      // ε trigger: fire process-alternatives in background
      let altCount = 0;
      try {
        const altRes = await fetch(`/api/decks/${encodeURIComponent(deck.id)}/process-alternatives${deckPasswordQuery}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({})
        });
        if (altRes.ok) {
          const altBody = await altRes.json() as { alternativesGenerated?: number };
          altCount = altBody.alternativesGenerated ?? 0;
        }
      } catch { /* best-effort */ }
      feedbackNotice = {
        kind: 'ok',
        text: altCount > 0
          ? `Feedback received. ${altCount} alternative slide${altCount === 1 ? '' : 's'} generated.`
          : 'Feedback received.',
        ref: body.proposal?.ref
      };
      await refreshStageAlternatives();
      if (activeAlternatives.length > 0) showAlternatives = true;
      feedbackText = '';
      pasteContext = '';
    } catch {
      feedbackNotice = { kind: 'err', text: 'Feedback submit failed (network).' };
    } finally {
      feedbackSubmitting = false;
    }
  }

  function pauseOrResume(): void {
    if (!currentTTSHandle) return;
    if (currentTTSHandle.isPaused()) {
      currentTTSHandle.resume();
      pausedIndex = null;
      return;
    }
    currentTTSHandle.pause();
    pausedIndex = speakingIndex;
    capturePauseSnapshot();
  }

  async function playCurrentSlide(): Promise<void> {
    if (!activeSlide) return;
    if (speakingIndex === activeIndex && currentTTSHandle) {
      pauseOrResume();
      return;
    }
    stopSpeaking();
    // Narration precedence (per JWPK deck-voice-spec 2026-05-22):
    //  1. slide.speakerNotes — written presenter notes
    //  2. slide.narration — explicit TTS-only voice line
    //  3. slide.content — on-slide bullets (last resort; you don't read off the slide)
    const narration = getNarrationForSlide(activeSlide);
    if (narration.length === 0) {
      voiceNotice = 'No speaker notes or narration for this slide.';
      return;
    }
    try {
      const provider = await resolveStageProvider();
      if (!provider) return;
      const handle = provider.speak(narration, {
        voiceId: voiceSettings.voiceId,
        deckId: deck.id,
        deckPassword: data.deckPassword ?? undefined
      });
      currentTTSHandle = handle;
      const indexAtStart = activeIndex;
      speakingIndex = indexAtStart;
      pausedIndex = null;
      speakStartMs = Date.now();
      handle.onStart = () => { speakingIndex = indexAtStart; speakStartMs = Date.now(); };
      handle.onEnd = () => {
        if (currentTTSHandle === handle) {
          currentTTSHandle = null;
          speakingIndex = null;
          pausedIndex = null;
        }
      };
    } catch {
      speakingIndex = null;
      pausedIndex = null;
      currentTTSHandle = null;
      voiceNotice = 'Could not play Stage voice.';
    }
  }

  async function copyShareLink(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      shareNotice = 'Clipboard API unavailable — copy the URL from the address bar.';
      return;
    }
    try {
      await navigator.clipboard.writeText(location.href);
      shareNotice = 'Link copied to clipboard.';
      setTimeout(() => (shareNotice = ''), 2500);
    } catch {
      shareNotice = 'Could not copy — copy from the address bar.';
    }
  }

  async function publishStageFocus(index: number): Promise<void> {
    const slide = slides[index];
    if (!slide) return;
    const focusRef = `${deck.id}:${slide.id}:${index}`;
    if (focusRef === lastPublishedFocusRef) return;
    lastPublishedFocusRef = focusRef;
    try {
      const response = await fetch(`/api/decks/${encodeURIComponent(deck.id)}/stage-focus${deckPasswordQuery}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slideId: slide.id,
          slideIndex: index,
          slideTitle: slide.title
        })
      });
      if (!response.ok) lastPublishedFocusRef = '';
    } catch {
      lastPublishedFocusRef = '';
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKey);
    void publishStageFocus(activeIndex);
    void refreshStageAlternatives();
    void loadVoiceSettings().then(() => {
      if (voiceSettings.autoplay) void playCurrentSlide();
    });
    return () => {
      stopSpeaking();
      window.removeEventListener('keydown', handleKey);
    };
  });
</script>

<svelte:head><title>{deck.title} | Deck | ANT vNext</title></svelte:head>

<SimplePageShell
  eyebrow="Deck"
  title={deck.title}
  summary={`From /rooms/${deck.roomId} · ${slideCount} slide${slideCount === 1 ? '' : 's'}`}
>
  <DeckViewerToolbar
    roomId={deck.roomId}
    {inspectMode}
    speakingThisSlide={speakingIndex === activeIndex}
    pausedThisSlide={pausedIndex === activeIndex}
    canStopVoice={speakingIndex === activeIndex}
    {showValidation}
    {lenses}
    {activeLensId}
    onToggleInspect={() => (inspectMode = !inspectMode)}
    onPlayPause={playCurrentSlide}
    onStop={stopSpeaking}
    onCopyShareLink={copyShareLink}
    onToggleValidation={toggleValidation}
    onLensChange={(lensId) => (activeLensId = lensId)}
  />

  {#if shareNotice}
    <p class="share-notice" role="status">{shareNotice}</p>
  {/if}

  {#if voiceNotice}
    <p class="share-notice" role="status">{voiceNotice}</p>
  {/if}

  {#if deck.parentDeckId}
    <p class="version-badge">
      Version B of <a href={'/decks/' + encodeURIComponent(deck.parentDeckId ?? '')}>parent deck</a>
    </p>
  {/if}

  {#if slideCount === 0}
    <p class="empty-deck">This deck has no slides yet.</p>
  {:else if activeSlide}
    <article class="slide" data-layout={activeSlide.layout ?? 'standard'}>
      <header class="slide-header">
        <h2 class="slide-title">{displayedSlideTitle}</h2>
        <span class="slide-counter">Slide {activeIndex + 1} of {slideCount}</span>
      </header>
      {#if visibleSlideAlternative}
        <p class="alternative-banner">
          Showing latest alternative · <button type="button" onclick={() => (showAlternatives = false)}>Show original</button>
        </p>
      {/if}
      <div class="slide-body">{@html renderedBody}</div>

      {#if showValidation && slideClaims.length > 0}
        <aside class="claims-panel" aria-label="Validation claims for this slide">
          <header class="claims-panel-header">
            <strong>Claims on this slide</strong>
            <span class="claims-count">{slideClaims.length}</span>
            <span class="claims-lens">via {lenses.find((l) => l.id === activeLensId)?.name ?? 'default lens'}</span>
          </header>
          <ol class="claims-list">
            {#each slideClaims as claim}
              <li class="claim-row">
                <span class="claim-num">Claim {claim.index}</span>
                <span class="claim-text">{claim.text}</span>
                <span class="claim-status" title="No verifier runs yet for this claim under the active lens.">unverified</span>
              </li>
            {/each}
          </ol>
          <p class="claims-note">Click-to-overlay (per-claim verifier runs) lands in a follow-up slice. v1: visible enumeration + active lens label so the presenter can see what's making claim-shaped statements.</p>
        </aside>
      {/if}
    </article>

    <nav class="deck-nav" aria-label="Slide navigation">
      <button type="button" class="nav-btn" onclick={prev} disabled={activeIndex === 0}>
        ← Previous
      </button>
      <div class="slide-dots" role="tablist" aria-label="Jump to slide">
        {#each slides as slide, index (slide.id)}
          <button
            type="button"
            class="dot"
            class:active={index === activeIndex}
            role="tab"
            aria-selected={index === activeIndex}
            aria-label={`Slide ${index + 1}: ${slide.title}`}
            onclick={() => clampedSet(index)}
          ></button>
        {/each}
      </div>
      <button type="button" class="nav-btn" onclick={next} disabled={activeIndex >= slideCount - 1}>
        Next →
      </button>
      {#if activeAlternatives.length > 0}
        <button
          type="button"
          class="nav-btn alt-nav-btn"
          aria-expanded={showAlternatives}
          onclick={() => {
            showAlternatives = !showAlternatives;
            selectedAlternativeRef = selectedAlternative?.ref ?? activeAlternatives[0]?.ref ?? '';
          }}
        >
          {showAlternatives ? 'Hide alternatives' : `See alternatives (${activeAlternatives.length})`}
        </button>
      {/if}
    </nav>

    {#if showAlternatives && activeAlternatives.length > 0}
      <section class="alternatives-panel" aria-label="Slide alternatives">
        <header>
          <h3>Alternatives for this slide</h3>
          <div class="alternative-mode">
            <button type="button" class:active={!visibleSlideAlternative} onclick={() => (showAlternatives = false)}>
              Original
            </button>
            {#if activeAlternatives.some((alt) => alt.kind === 'slide')}
              <button
                type="button"
                class:active={!!visibleSlideAlternative}
                onclick={() => {
                  const latestSlide = activeAlternatives.find((alt) => alt.kind === 'slide');
                  selectedAlternativeRef = latestSlide?.ref ?? selectedAlternativeRef;
                  showAlternatives = true;
                }}
              >
                Latest slide
              </button>
            {/if}
          </div>
        </header>
        <ul>
          {#each activeAlternatives as alternative (alternative.ref)}
            <li class:active={alternative.ref === selectedAlternative?.ref}>
              <button
                type="button"
                onclick={() => {
                  selectedAlternativeRef = alternative.ref;
                  showAlternatives = true;
                }}
              >
                <span>{alternative.kind === 'proposal' ? (alternative.lens ?? 'Proposal') : 'Slide rewrite'}</span>
                <strong>{alternative.label}</strong>
              </button>
              {#if alternative.kind === 'proposal'}
                <a href={alternative.ref} target="_blank" rel="noopener">Open track</a>
              {:else}
                <p>{alternative.rationale}</p>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}

  {#if inspectMode && activeSlide}
    <section class="inspector" aria-label="Slide source">
      <header><h3>Slide JSON</h3></header>
      <pre><code>{JSON.stringify(activeSlide, null, 2)}</code></pre>
    </section>
  {/if}

  <StageFeedbackPanel
    {pauseSnapshot}
    bind:feedbackText
    bind:pasteContext
    {feedbackSubmitting}
    {feedbackNotice}
    onSubmit={submitFeedback}
    onClear={() => {
      pauseSnapshot = null;
      feedbackText = '';
      pasteContext = '';
      pauseContextRef = '';
      feedbackNotice = null;
    }}
  />

  <footer class="deck-meta">
    <span>Created {new Date(deck.createdAtMs).toLocaleString()}</span>
    {#if deck.createdBy}<span> · by {deck.createdBy}</span>{/if}
    {#if deck.updatedAtMs}<span> · updated {new Date(deck.updatedAtMs).toLocaleString()}</span>{/if}
  </footer>
</SimplePageShell>

<style>
  .share-notice {
    margin: 0 0 0.85rem;
    padding: 0.55rem 0.85rem;
    border: 1px solid var(--accent);
    border-radius: 0.65rem;
    background: color-mix(in srgb, var(--accent) 12%, var(--surface-card));
    color: var(--ink-strong);
    font-weight: 700;
    font-size: 0.85rem;
  }
  .empty-deck {
    padding: 2rem 1rem;
    text-align: center;
    color: var(--ink-soft);
  }
  .slide {
    border: 1px solid var(--line-soft);
    border-radius: 1rem;
    background: var(--surface-card);
    padding: 2rem 2.2rem;
    box-shadow: 0 14px 36px rgb(0 0 0 / 5%);
    min-height: 50vh;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .slide-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 1px solid var(--line-soft);
    padding-bottom: 0.85rem;
  }
  .slide-title {
    margin: 0;
    font-size: 1.4rem;
    color: var(--ink-strong);
  }
  .slide-counter {
    color: var(--ink-soft);
    font-size: 0.85rem;
    font-weight: 700;
    flex-shrink: 0;
  }
  .alternative-banner {
    margin: 0;
    padding: 0.55rem 0.75rem;
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--line-soft));
    border-radius: 0.65rem;
    background: color-mix(in srgb, var(--accent) 10%, var(--surface-card));
    color: var(--ink-soft);
    font-size: 0.85rem;
    font-weight: 750;
  }
  .alternative-banner button {
    border: 0;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-weight: 850;
    cursor: pointer;
    text-decoration: underline;
  }
  .slide-body {
    flex: 1;
    color: var(--ink-strong);
    line-height: 1.55;
  }
  .claims-panel {
    margin-top: 1.25rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.5rem;
    background: var(--surface-raised);
  }
  .claims-panel-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--ink-soft);
    margin-bottom: 0.5rem;
  }
  .claims-panel-header strong { color: var(--ink-strong); }
  .claims-count {
    background: var(--accent);
    color: white;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 700;
  }
  .claims-lens { margin-left: auto; font-style: italic; }
  .claims-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .claim-row {
    display: flex;
    gap: 0.65rem;
    padding: 0.4rem 0;
    border-bottom: 1px dashed var(--line-soft);
    align-items: baseline;
  }
  .claim-row:last-child { border-bottom: none; }
  .claim-num {
    flex: 0 0 5rem;
    font-weight: 700;
    color: var(--accent);
    font-size: 0.82rem;
  }
  .claim-text {
    flex: 1;
    font-size: 0.88rem;
    color: var(--ink-strong);
  }
  .claim-status {
    flex: 0 0 auto;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    font-size: 0.72rem;
    background: var(--bg);
    color: var(--ink-soft);
    border: 1px solid var(--line-soft);
  }
  .claims-note {
    font-size: 0.75rem;
    color: var(--ink-soft);
    margin: 0.6rem 0 0 0;
    font-style: italic;
  }
  .slide-body :global(h1),
  .slide-body :global(h2),
  .slide-body :global(h3) { color: var(--ink-strong); }
  .slide-body :global(code) {
    padding: 0.05rem 0.35rem;
    border-radius: 0.3rem;
    background: var(--bg);
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.9em;
  }
  .slide-body :global(pre) {
    padding: 0.85rem 1rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.65rem;
    background: var(--bg);
    overflow-x: auto;
  }
  .slide-body :global(pre code) {
    padding: 0;
    background: transparent;
  }
  .slide-body :global(ul),
  .slide-body :global(ol) { padding-left: 1.4rem; }
  .deck-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 1rem;
  }
  .nav-btn {
    padding: 0.6rem 1.2rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--ink-strong);
    font: inherit;
    font-weight: 800;
    cursor: pointer;
  }
  .nav-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .nav-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .alt-nav-btn {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--line-soft));
    color: var(--accent);
  }
  .slide-dots {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
    justify-content: center;
  }
  .dot {
    width: 0.65rem;
    height: 0.65rem;
    border: 1px solid var(--line-soft);
    border-radius: 50%;
    background: var(--bg);
    cursor: pointer;
    padding: 0;
    transition: background 0.12s, transform 0.12s;
  }
  .dot:hover { transform: scale(1.2); }
  .dot.active {
    background: var(--accent);
    border-color: var(--accent);
  }
  .alternatives-panel {
    margin-top: 1rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    background: var(--surface-card);
    overflow: hidden;
  }
  .alternatives-panel header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.8rem 1rem;
    border-bottom: 1px solid var(--line-soft);
  }
  .alternatives-panel h3 {
    margin: 0;
    font-size: 0.9rem;
    color: var(--ink-strong);
  }
  .alternative-mode {
    display: flex;
    gap: 0.35rem;
  }
  .alternative-mode button {
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--bg);
    color: var(--ink-soft);
    padding: 0.35rem 0.65rem;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 800;
    cursor: pointer;
  }
  .alternative-mode button.active {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--surface-card));
  }
  .alternatives-panel ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .alternatives-panel li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.65rem;
    align-items: center;
    padding: 0.8rem 1rem;
    border-bottom: 1px solid var(--line-soft);
  }
  .alternatives-panel li:last-child { border-bottom: 0; }
  .alternatives-panel li.active {
    background: color-mix(in srgb, var(--accent) 8%, var(--surface-card));
  }
  .alternatives-panel li > button {
    min-width: 0;
    border: 0;
    background: transparent;
    color: inherit;
    padding: 0;
    text-align: left;
    cursor: pointer;
  }
  .alternatives-panel li span {
    display: block;
    color: var(--ink-soft);
    font-size: 0.72rem;
    font-weight: 850;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .alternatives-panel li strong {
    display: block;
    margin-top: 0.2rem;
    color: var(--ink-strong);
    font-size: 0.88rem;
    line-height: 1.25;
  }
  .alternatives-panel a {
    color: var(--accent);
    font-size: 0.82rem;
    font-weight: 850;
    white-space: nowrap;
  }
  .alternatives-panel p {
    grid-column: 1 / -1;
    margin: -0.35rem 0 0;
    color: var(--ink-soft);
    font-size: 0.82rem;
  }
  .inspector {
    margin-top: 1.25rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    background: var(--bg);
    overflow: hidden;
  }
  .inspector header {
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--line-soft);
    background: var(--surface-card);
  }
  .inspector header h3 {
    margin: 0;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-soft);
  }
  .inspector pre {
    margin: 0;
    padding: 1rem 1.25rem;
    overflow-x: auto;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.82rem;
    color: var(--ink-strong);
  }
  .deck-meta {
    margin-top: 1.5rem;
    padding-top: 0.85rem;
    border-top: 1px solid var(--line-soft);
    color: var(--ink-soft);
    font-size: 0.8rem;
  }
  .version-badge {
    font-size: 0.8125rem;
    color: var(--ink-muted);
    background: rgba(59, 130, 246, 0.08);
    border: 1px solid rgba(59, 130, 246, 0.2);
    border-radius: 0.375rem;
    padding: 0.375rem 0.75rem;
    margin-bottom: 0.75rem;
  }
  .version-badge a {
    color: #1d4ed8;
    text-decoration: underline;
  }
</style>
