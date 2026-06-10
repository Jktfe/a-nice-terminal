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
  import { invalidate } from '$app/navigation';
  import DeckViewerToolbar from '$lib/components/DeckViewerToolbar.svelte';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import StageFeedbackPanel from '$lib/components/StageFeedbackPanel.svelte';
  import Explainable from '$lib/components/Explainable.svelte';
  import ClaimValidationOverlay from '$lib/components/ClaimValidationOverlay.svelte';
  import { renderMarkdown } from '$lib/chat/renderMarkdown';
  import { externalDeckSourceFromTheme } from '$lib/externalDeckSubstrate';
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
  // Safari blocks HTMLAudioElement and speechSynthesis playback without a
  // user gesture. We unlock on the first explicit Play / Next / Prev so
  // that ElevenLabs and browser TTS both work on mobile Safari.
  let safariAudioUnlocked = $state(false);
  function unlockSafariAudio(): void {
    if (safariAudioUnlocked || typeof window === 'undefined') return;
    safariAudioUnlocked = true;
    const a = new Audio();
    void a.play().catch(() => {});
    if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance('');
      window.speechSynthesis.speak(u);
      window.speechSynthesis.cancel();
    }
  }
  // Stage Validation UX (JWPK feedback msg_pub8alsnxf 2026-05-24 + screenshot):
  // when toggle ON, render a lens dropdown + visible "Claim N" numbering on
  // each paragraph/bullet in slide content. Click-to-overlay is a follow-up
  // slice; v1 ships the toggle + lens selection + visual numbering.
  let showValidation = $state(false);
  let selectedClaimForOverlay = $state<{index: number; text: string} | null>(null);
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
    modelId?: string;
    voiceName?: string;
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
  type StageAlternativeDecisionAction =
    | 'replace-slide'
    | 'append-after'
    | 'append-appendix'
    | 'park'
    | 'reject';
  type StageAlternativeDecision = {
    alternativeRef: string;
    action: StageAlternativeDecisionAction;
    decidedBy: string;
    decidedAtMs: number;
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
        feedbackRef: string | null;
        label: string;
        originalTitle: string | null;
        proposedTitle: string;
        proposedContent: string;
        proposedSpeakerNotes: string;
        rationale: string;
        createdAtMs: number;
        decision: StageAlternativeDecision | null;
      };
  type StagePresentedSlide = DeckSlide & {
    source: 'original' | 'alternative';
    sourceSlideIndex: number;
    sourceAlternativeRef?: string;
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
  const externalDeckSource = $derived(externalDeckSourceFromTheme(deck.theme));
  const deckPasswordQuery = $derived(data.deckPassword ? `?password=${encodeURIComponent(data.deckPassword)}` : '');
  const originalSlides = $derived(deck.slides ?? []);
  const slideAlternatives = $derived(
    stageAlternatives.filter((alt): alt is Extract<StageAlternativeOption, { kind: 'slide' }> => alt.kind === 'slide')
  );
  function slideFromAlternative(alternative: Extract<StageAlternativeOption, { kind: 'slide' }>, idPrefix: string): StagePresentedSlide {
    return {
      id: `${idPrefix}-${alternative.slideIndex}`,
      title: alternative.proposedTitle,
      content: alternative.proposedContent,
      speakerNotes: alternative.proposedSpeakerNotes,
      source: 'alternative',
      sourceSlideIndex: alternative.slideIndex,
      sourceAlternativeRef: alternative.ref
    };
  }
  const composedSlides = $derived.by<StagePresentedSlide[]>(() => {
    const replacements = new Map<number, Extract<StageAlternativeOption, { kind: 'slide' }>>();
    const appendAfter = new Map<number, Extract<StageAlternativeOption, { kind: 'slide' }>[]>();
    const appendix: Extract<StageAlternativeOption, { kind: 'slide' }>[] = [];

    for (const alternative of slideAlternatives) {
      const action = alternative.decision?.action;
      if (!action || action === 'park' || action === 'reject') continue;
      if (action === 'replace-slide') {
        const incumbent = replacements.get(alternative.slideIndex);
        if (!incumbent || (alternative.decision?.decidedAtMs ?? 0) >= (incumbent.decision?.decidedAtMs ?? 0)) {
          replacements.set(alternative.slideIndex, alternative);
        }
      } else if (action === 'append-after') {
        const list = appendAfter.get(alternative.slideIndex) ?? [];
        list.push(alternative);
        list.sort((a, b) => (a.decision?.decidedAtMs ?? 0) - (b.decision?.decidedAtMs ?? 0));
        appendAfter.set(alternative.slideIndex, list);
      } else if (action === 'append-appendix') {
        appendix.push(alternative);
      }
    }
    appendix.sort((a, b) => (a.decision?.decidedAtMs ?? 0) - (b.decision?.decidedAtMs ?? 0));

    const out: StagePresentedSlide[] = [];
    for (let index = 0; index < originalSlides.length; index += 1) {
      const replacement = replacements.get(index);
      out.push(replacement ? slideFromAlternative(replacement, 'alt-slide') : {
        ...originalSlides[index],
        source: 'original',
        sourceSlideIndex: index
      });
      for (const alternative of appendAfter.get(index) ?? []) {
        out.push(slideFromAlternative(alternative, 'after-alt-slide'));
      }
    }
    for (const alternative of appendix) {
      out.push(slideFromAlternative(alternative, 'appendix-alt-slide'));
    }
    return out;
  });
  const slides = $derived(composedSlides);
  const slideCount = $derived(slides.length);
  const activeSlide = $derived(slides[activeIndex]);
  const activeSourceSlideIndex = $derived(activeSlide?.sourceSlideIndex ?? activeIndex);
  const activeAlternatives = $derived(
    stageAlternatives.filter((alt) => alt.slideIndex === activeSourceSlideIndex)
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

  function showAlternativeForSource(sourceIndex: number, ref: string): void {
    const composedIndex = slides.findIndex((candidate) => candidate.sourceSlideIndex === sourceIndex);
    if (composedIndex >= 0 && composedIndex !== activeIndex) {
      clampedSet(composedIndex);
    }
    selectedAlternativeRef = ref;
    showAlternatives = true;
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
        default_model_id?: string;
      };
      const deckVoicePreset = deck.voicePreset;
      const provider = settings.stage_provider === 'browser' || settings.stage_provider === 'off'
        ? settings.stage_provider
        : 'elevenlabs';
      voiceSettings = {
        provider,
        autoplay: settings.stage_autoplay !== false,
        elevenLabsAvailable: settings.available === true,
        voiceId: typeof deckVoicePreset?.voiceId === 'string'
          ? deckVoicePreset.voiceId
          : (typeof settings.default_voice_id === 'string' ? settings.default_voice_id : undefined),
        modelId: typeof deckVoicePreset?.modelId === 'string'
          ? deckVoicePreset.modelId
          : (typeof settings.default_model_id === 'string' ? settings.default_model_id : undefined),
        voiceName: typeof deckVoicePreset?.name === 'string' ? deckVoicePreset.name : undefined
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

  async function chooseAlternativePath(
    alternative: Extract<StageAlternativeOption, { kind: 'slide' }>,
    action: StageAlternativeDecisionAction
  ): Promise<void> {
    try {
      const response = await fetch(`/api/decks/${encodeURIComponent(deck.id)}/alternatives/decision${deckPasswordQuery}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alternativeRef: alternative.ref, action })
      });
      if (!response.ok) {
        feedbackNotice = { kind: 'err', text: `Alternative decision failed (HTTP ${response.status}).` };
        return;
      }
      await refreshStageAlternatives();
      feedbackNotice = { kind: 'ok', text: `Alternative set to ${action}.` };
    } catch {
      feedbackNotice = { kind: 'err', text: 'Alternative decision failed (network).' };
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
    voiceNotice = voiceSettings.voiceName
      ? `Using ${voiceSettings.voiceName}.`
      : 'Using ElevenLabs Stage voice.';
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
      slideIndex: activeSlide.sourceSlideIndex,
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
    if (!activeSlide || feedbackText.trim().length === 0 || feedbackSubmitting) return;
    feedbackSubmitting = true;
    feedbackNotice = null;
    const feedbackSlideIndex = pauseSnapshot?.slideIndex ?? activeSourceSlideIndex;
    try {
      const response = await fetch(`/api/decks/${encodeURIComponent(deck.id)}/stage-feedback${deckPasswordQuery}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slideIndex: feedbackSlideIndex,
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
    unlockSafariAudio();
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
        modelId: voiceSettings.modelId,
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

    // Live Stage (JWPK 2026-06-10): agents edit the deck on the fly — adding to
    // the alternative track and (via @researchant's auto-adopt) replacing /
    // appending / parking slides. composedSlides already renders all of that,
    // but the viewer only re-read alternatives on mount + the presenter's OWN
    // actions, so a REMOTE agent change never appeared until a manual reload.
    // Poll both surfaces so it shows up in real time:
    //   - refreshStageAlternatives(): new alternatives + their decisions →
    //     composedSlides re-applies replace/append/park live.
    //   - guarded deck reload: an agent editing the BASE deck (reorder/hide via
    //     updateDeck) bumps updatedAtMs; only THEN invalidate the load, so the
    //     view doesn't churn the deck every tick.
    let lastDeckStamp = deck.updatedAtMs ?? deck.createdAtMs ?? 0;
    const livePoll = setInterval(() => {
      void refreshStageAlternatives();
      void (async () => {
        try {
          const res = await fetch(`/api/decks/${encodeURIComponent(deck.id)}${deckPasswordQuery}`);
          if (!res.ok) return;
          const body = (await res.json()) as { deck?: { updatedAtMs?: number | null } };
          const stamp = body.deck?.updatedAtMs ?? 0;
          if (stamp > lastDeckStamp) {
            lastDeckStamp = stamp;
            await invalidate((url) => url.pathname === `/api/decks/${deck.id}`);
          }
        } catch {
          // Best-effort live poll — a failed tick must never disrupt the deck.
        }
      })();
    }, 3000);

    return () => {
      stopSpeaking();
      window.removeEventListener('keydown', handleKey);
      clearInterval(livePoll);
    };
  });
</script>

<svelte:head><title>{deck.title} | Deck | ANT vNext</title></svelte:head>

<SimplePageShell
  eyebrow="Deck"
  title={deck.title}
  summary={externalDeckSource ? `From /rooms/${deck.roomId} · ${externalDeckSource.label} deck ${externalDeckSource.path}` : `From /rooms/${deck.roomId} · ${slideCount} slide${slideCount === 1 ? '' : 's'}`}
>
  <div class="stage-command-strip">
    <Explainable explainKey="deck-voice"><DeckViewerToolbar
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
    /></Explainable>
    <details class="assets-menu">
      <summary>Assets</summary>
      <div class="assets-menu-panel">
        <a href={`/rooms/${encodeURIComponent(deck.roomId)}`}>Room record</a>
        <button type="button" onclick={() => (inspectMode = true)}>Slide JSON</button>
        {#if externalDeckSource}
          <a href={externalDeckSource.path} target="_blank" rel="noreferrer">{externalDeckSource.label} source</a>
        {/if}
        <span>{stageAlternatives.length} alternative track{stageAlternatives.length === 1 ? '' : 's'}</span>
      </div>
    </details>
  </div>

  {#if shareNotice}
    <p class="share-notice" role="status">{shareNotice}</p>
  {/if}

  {#if voiceNotice}
    <p class="share-notice" role="status">{voiceNotice}</p>
  {/if}
  {#if !safariAudioUnlocked}
    <p class="share-notice unlock-hint" role="status">
      Tap Start voice, Next, or Prev to enable audio on this browser.
    </p>
  {/if}

  {#if deck.parentDeckId}
    <p class="version-badge">
      Version B of <a href={'/decks/' + encodeURIComponent(deck.parentDeckId ?? '')}>parent deck</a>
    </p>
  {/if}

  {#if externalDeckSource}
    <section class="external-deck-stage" aria-label={`${externalDeckSource.label} deck`}>
      <header>
        <span>{externalDeckSource.label} source</span>
        <a href={externalDeckSource.path} target="_blank" rel="noreferrer">Open full deck</a>
      </header>
      <iframe
        title={`${deck.title} ${externalDeckSource.label} deck`}
        src={externalDeckSource.path}
      ></iframe>
    </section>
  {:else if slideCount === 0}
    <p class="empty-deck">This deck has no slides yet.</p>
  {:else if activeSlide}
    <section class="stage-cockpit" aria-label="ANT Stage presenter workspace">
      <div class="stage-main-column">
        <article class="slide" data-layout={activeSlide.layout ?? 'standard'}>
          <header class="slide-header">
            <div>
              <p class="slide-kicker">Main deck</p>
              <h2 class="slide-title">{displayedSlideTitle}</h2>
            </div>
            <span class="slide-counter">Slide {activeIndex + 1} of {slideCount}</span>
          </header>
          {#if visibleSlideAlternative}
            <p class="alternative-banner">
              Showing latest alternative · <button type="button" onclick={() => (showAlternatives = false)}>Show original</button>
            </p>
          {/if}
          <div class="slide-body">{@html renderedBody}</div>

          {#if showValidation && slideClaims.length > 0}
            <Explainable explainKey="deck-validation">
            <aside class="claims-panel" aria-label="Validation claims for this slide">
              <header class="claims-panel-header">
                <strong>Verification panel</strong>
                <span class="claims-count">{slideClaims.length}</span>
                <span class="claims-lens">via {lenses.find((l) => l.id === activeLensId)?.name ?? 'default lens'}</span>
              </header>
              <ol class="claims-list">
                {#each slideClaims as claim}
                  <li class="claim-row">
                    <button type="button" class="claim-btn" onclick={() => (selectedClaimForOverlay = {index: claim.index, text: claim.text})} title="Click to view validation runs.">
                      <span class="claim-num">Claim {claim.index}</span>
                      <span class="claim-text">{claim.text}</span>
                      <span class="claim-status">unverified</span>
                    </button>
                  </li>
                {/each}
              </ol>
              <p class="claims-note">Click-to-overlay (per-claim verifier runs) lands in a follow-up slice. v1: visible enumeration + active lens label so the presenter can see what's making claim-shaped statements.</p>
            </aside>
            </Explainable>
            {#if selectedClaimForOverlay}
              <ClaimValidationOverlay
                claimIndex={selectedClaimForOverlay.index}
                claimText={selectedClaimForOverlay.text}
                onClose={() => (selectedClaimForOverlay = null)}
              />
            {/if}
          {/if}
        </article>

        <nav class="deck-nav" aria-label="Slide navigation">
          <button type="button" class="nav-btn" onclick={prev} disabled={activeIndex === 0}>
            ← Previous
          </button>
          <button type="button" class="nav-btn" onclick={next} disabled={activeIndex >= slideCount - 1}>
            Next →
          </button>
        </nav>
      </div>

      <aside class="stage-side-column" aria-label="Stage comments and version history">
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

        <section class="version-history-panel" aria-label="Version history">
          <header>
            <p class="panel-kicker">Version History</p>
            <h3>Slide {activeSourceSlideIndex + 1}</h3>
          </header>
          <ul class="version-history-list">
            <li class:active={!visibleSlideAlternative}>
              <button type="button" onclick={() => (showAlternatives = false)}>
                <span>V1</span>
                <strong>{originalSlides[activeSourceSlideIndex]?.title ?? activeSlide.title}</strong>
                <em>{visibleSlideAlternative ? 'View' : 'Viewing'}</em>
              </button>
            </li>
            {#each activeAlternatives as alternative (alternative.ref)}
              <li class:active={alternative.ref === selectedAlternative?.ref && showAlternatives}>
                <button
                  type="button"
                  onclick={() => {
                    if (alternative.kind === 'slide') {
                      showAlternativeForSource(alternative.slideIndex, alternative.ref);
                    }
                  }}
                >
                  <span>{alternative.kind === 'proposal' ? 'V1 feedback' : 'V2'}</span>
                  <strong>
                    {alternative.kind === 'proposal'
                      ? (alternative.summary ?? alternative.label)
                      : alternative.proposedTitle}
                  </strong>
                  <em>{alternative.ref === selectedAlternative?.ref && showAlternatives ? 'Viewing' : 'View'}</em>
                </button>
                {#if alternative.kind === 'proposal'}
                  <a href={alternative.ref} target="_blank" rel="noopener">Open comment track</a>
                {:else}
                  <p>{alternative.rationale}</p>
                  {#if alternative.feedbackRef}
                    <p class="alternative-feedback-ref">Addresses feedback {alternative.feedbackRef}</p>
                  {/if}
                  {#if alternative.decision}
                    <p class="alternative-decision">Current path: {alternative.decision.action}</p>
                  {/if}
                  <div class="alternative-actions" aria-label="Choose presentation path">
                    <button type="button" onclick={() => chooseAlternativePath(alternative, 'replace-slide')}>
                      Replace
                    </button>
                    <button type="button" onclick={() => chooseAlternativePath(alternative, 'append-after')}>
                      Append after
                    </button>
                    <button type="button" onclick={() => chooseAlternativePath(alternative, 'append-appendix')}>
                      Appendix
                    </button>
                    <button type="button" onclick={() => chooseAlternativePath(alternative, 'park')}>
                      Park
                    </button>
                    <button type="button" onclick={() => chooseAlternativePath(alternative, 'reject')}>
                      Reject
                    </button>
                  </div>
                {/if}
              </li>
            {/each}
            {#if feedbackSubmitting}
              <li class="response-row">
                <span>Response working on...</span>
              </li>
            {:else if feedbackNotice?.kind === 'ok'}
              <li class="response-row">
                <span>Response received</span>
              </li>
            {/if}
            {#if activeAlternatives.length === 0}
              <li class="empty-version-row">
                <span>No comments or Version B slides for this slide yet.</span>
              </li>
            {/if}
          </ul>
        </section>
      </aside>
    </section>

    <section class="slide-picker" aria-label="Slide picker">
      <header>
        <h3>Slide picker</h3>
        <p>Pick a slide, then view or adopt slide-specific versions.</p>
      </header>
      <div class="slide-picker-grid" role="tablist" aria-label="Jump to slide">
        {#each originalSlides as slide, index (slide.id)}
          {@const sourceAlternatives = stageAlternatives.filter((alt) => alt.slideIndex === index)}
          <div class="slide-picker-stack">
            <button
              type="button"
              class="slide-picker-card"
              class:active={activeSourceSlideIndex === index && !visibleSlideAlternative}
              role="tab"
              aria-selected={activeSourceSlideIndex === index && !visibleSlideAlternative}
              onclick={() => {
                const composedIndex = slides.findIndex((candidate) => candidate.sourceSlideIndex === index && candidate.source === 'original');
                showAlternatives = false;
                selectedAlternativeRef = '';
                clampedSet(composedIndex >= 0 ? composedIndex : index);
              }}
            >
              <span class="slide-picker-actions" aria-label={`Slide ${index + 1} actions`}>
                <span>Hide</span>
                <span>Delete</span>
                <span>Move</span>
              </span>
              <span>Slide {index + 1}</span>
              <strong>{slide.title}</strong>
              {#if sourceAlternatives.length > 0}
                <em>{sourceAlternatives.length} track{sourceAlternatives.length === 1 ? '' : 's'}</em>
              {/if}
            </button>
            {#each sourceAlternatives.filter((alt) => alt.kind === 'slide') as alternative, versionIndex (alternative.ref)}
              <button
                type="button"
                class="slide-picker-version"
                class:active={alternative.ref === selectedAlternative?.ref && showAlternatives}
                onclick={() => showAlternativeForSource(index, alternative.ref)}
              >
                v{versionIndex + 2}
              </button>
            {/each}
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if inspectMode && activeSlide}
    <section class="inspector" aria-label="Slide source">
      <header><h3>Slide JSON</h3></header>
      <pre><code>{JSON.stringify(activeSlide, null, 2)}</code></pre>
    </section>
  {/if}

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
  .stage-command-strip {
    display: flex;
    align-items: flex-start;
    gap: 0.7rem;
    margin-bottom: 1rem;
  }
  .stage-command-strip :global(.explainable) {
    min-width: 0;
    flex: 1;
  }
  .assets-menu {
    position: relative;
    flex: 0 0 auto;
    margin-top: 0.55rem;
  }
  .assets-menu summary {
    list-style: none;
    padding: 0.45rem 0.85rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--ink-strong);
    font-size: 0.82rem;
    font-weight: 850;
    cursor: pointer;
  }
  .assets-menu summary::-webkit-details-marker { display: none; }
  .assets-menu[open] summary,
  .assets-menu summary:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .assets-menu-panel {
    position: absolute;
    z-index: 6;
    right: 0;
    top: calc(100% + 0.45rem);
    display: grid;
    gap: 0.35rem;
    min-width: 13rem;
    padding: 0.65rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.75rem;
    background: var(--surface-card);
    box-shadow: 0 20px 44px rgb(0 0 0 / 14%);
  }
  .assets-menu-panel a,
  .assets-menu-panel button,
  .assets-menu-panel span {
    display: block;
    width: 100%;
    padding: 0.42rem 0.5rem;
    border: 0;
    border-radius: 0.45rem;
    background: transparent;
    color: var(--ink-strong);
    font: inherit;
    font-size: 0.8rem;
    font-weight: 780;
    text-align: left;
    text-decoration: none;
  }
  .assets-menu-panel a:hover,
  .assets-menu-panel button:hover {
    background: color-mix(in srgb, var(--accent) 10%, var(--surface-card));
    color: var(--accent);
  }
  .empty-deck {
    padding: 2rem 1rem;
    text-align: center;
    color: var(--ink-soft);
  }
  .stage-cockpit {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(19rem, 25rem);
    gap: 1rem;
    align-items: start;
  }
  .stage-main-column,
  .stage-side-column {
    min-width: 0;
  }
  .stage-side-column {
    display: grid;
    gap: 1rem;
  }
  .external-deck-stage {
    display: grid;
    grid-template-rows: auto minmax(32rem, 74vh);
    border: 1px solid var(--line-soft);
    border-radius: 1rem;
    background: var(--surface-card);
    box-shadow: 0 14px 36px rgb(0 0 0 / 5%);
    overflow: hidden;
  }
  .external-deck-stage header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.7rem 0.95rem;
    border-bottom: 1px solid var(--line-soft);
    color: var(--ink-soft);
    font-size: 0.82rem;
    font-weight: 850;
  }
  .external-deck-stage a {
    color: var(--accent);
    text-decoration: none;
  }
  .external-deck-stage a:hover {
    text-decoration: underline;
  }
  .external-deck-stage iframe {
    width: 100%;
    height: 100%;
    border: 0;
    background: white;
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
  .slide-kicker,
  .panel-kicker {
    margin: 0 0 0.2rem;
    color: var(--accent);
    font-size: 0.68rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
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
  .claim-btn {
    display: flex; align-items: center; gap: 0.6rem; width: 100%;
    padding: 0.4rem 0; border: none; background: transparent;
    color: inherit; font: inherit; text-align: left; cursor: pointer;
  }
  .claim-btn:hover { background: var(--surface-raised); border-radius: 0.3rem; }
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
  .slide-body :global(img) {
    display: block;
    max-width: min(100%, 960px);
    max-height: 54vh;
    margin: 1rem auto;
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    background: var(--surface-card);
    box-shadow: 0 18px 42px rgb(0 0 0 / 8%);
    object-fit: contain;
  }
  .slide-body :global(ul),
  .slide-body :global(ol) { padding-left: 1.4rem; }
  .deck-nav {
    display: flex;
    align-items: center;
    justify-content: flex-end;
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
  .version-history-panel,
  .slide-picker {
    border: 1px solid var(--line-soft);
    border-radius: 1rem;
    background: var(--surface-card);
    box-shadow: 0 14px 36px rgb(0 0 0 / 5%);
    overflow: hidden;
  }
  .version-history-panel > header,
  .slide-picker > header {
    padding: 0.85rem 1rem;
    border-bottom: 1px solid var(--line-soft);
  }
  .version-history-panel h3,
  .slide-picker h3 {
    margin: 0;
    color: var(--ink-strong);
    font-size: 1rem;
  }
  .slide-picker p {
    margin: 0.25rem 0 0;
    color: var(--ink-soft);
    font-size: 0.82rem;
  }
  .version-history-list {
    display: grid;
    gap: 0.55rem;
    margin: 0;
    padding: 0.85rem;
    list-style: none;
  }
  .version-history-list li {
    border: 1px solid var(--line-soft);
    border-radius: 0.72rem;
    background: var(--bg);
    overflow: hidden;
  }
  .version-history-list li.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 9%, var(--surface-card));
  }
  .version-history-list li > button {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 0.65rem;
    align-items: center;
    width: 100%;
    padding: 0.62rem 0.68rem;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .version-history-list li span {
    color: var(--accent);
    font-size: 0.75rem;
    font-weight: 900;
    text-transform: uppercase;
  }
  .version-history-list li strong {
    min-width: 0;
    overflow: hidden;
    color: var(--ink-strong);
    font-size: 0.83rem;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .version-history-list li em {
    padding: 0.18rem 0.5rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--ink-soft);
    font-size: 0.66rem;
    font-style: normal;
    font-weight: 900;
    text-transform: uppercase;
  }
  .version-history-list li.active em {
    border-color: var(--accent);
    color: var(--accent);
  }
  .version-history-list a {
    display: inline-block;
    margin: -0.15rem 0 0.65rem 0.68rem;
    color: var(--accent);
    font-size: 0.78rem;
    font-weight: 850;
  }
  .version-history-list p {
    margin: -0.15rem 0.68rem 0.65rem;
    color: var(--ink-soft);
    font-size: 0.78rem;
    line-height: 1.35;
  }
  .empty-version-row {
    padding: 0.7rem;
    color: var(--ink-soft);
    font-size: 0.82rem;
  }
  .response-row {
    padding: 0.62rem 0.68rem;
    border-style: dashed;
    color: var(--accent);
    font-size: 0.78rem;
    font-weight: 900;
  }
  .slide-picker {
    margin-top: 1rem;
  }
  .slide-picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
    gap: 0.8rem;
    padding: 1rem;
  }
  .slide-picker-stack {
    display: grid;
    justify-items: center;
    gap: 0.4rem;
    min-width: 0;
  }
  .slide-picker-card,
  .slide-picker-version {
    border: 1px solid var(--line-soft);
    background: var(--bg);
    color: var(--ink-strong);
    font: inherit;
    cursor: pointer;
    transition: border-color 0.12s, transform 0.12s, background 0.12s;
  }
  .slide-picker-card {
    position: relative;
    display: grid;
    gap: 0.25rem;
    width: 100%;
    min-height: 5.9rem;
    padding: 1rem 0.82rem 0.72rem;
    border-radius: 1rem;
    text-align: left;
  }
  .slide-picker-card:hover,
  .slide-picker-card.active,
  .slide-picker-version:hover,
  .slide-picker-version.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, var(--surface-card));
    transform: translateY(-1px);
  }
  .slide-picker-card > span:not(.slide-picker-actions) {
    color: var(--accent);
    font-size: 0.72rem;
    font-weight: 900;
    text-transform: uppercase;
  }
  .slide-picker-card strong {
    display: -webkit-box;
    overflow: hidden;
    color: var(--ink-strong);
    font-size: 0.84rem;
    line-height: 1.2;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
  .slide-picker-card em {
    color: var(--ink-soft);
    font-size: 0.68rem;
    font-style: normal;
    font-weight: 800;
  }
  .slide-picker-actions {
    position: absolute;
    top: -0.72rem;
    left: 50%;
    display: flex;
    gap: 0.2rem;
    padding: 0.16rem 0.28rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.35rem;
    background: var(--surface-card);
    color: var(--ink-soft);
    opacity: 0;
    pointer-events: none;
    transform: translateX(-50%);
  }
  .slide-picker-card:hover .slide-picker-actions,
  .slide-picker-card:focus-visible .slide-picker-actions {
    opacity: 1;
  }
  .slide-picker-actions span {
    color: var(--ink-soft);
    font-size: 0.55rem;
    font-weight: 900;
    white-space: nowrap;
  }
  .slide-picker-version {
    width: min(5.2rem, 80%);
    padding: 0.4rem 0.55rem;
    border-radius: 0.75rem;
    color: var(--accent);
    font-size: 0.74rem;
    font-weight: 900;
    text-transform: uppercase;
  }
  .alternative-feedback-ref,
  .alternative-decision {
    color: var(--ink-soft);
    font-size: 0.76rem;
  }
  .alternative-actions {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .alternative-actions button {
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--bg);
    color: var(--ink-strong);
    padding: 0.38rem 0.62rem;
    font: inherit;
    font-size: 0.76rem;
    font-weight: 850;
    cursor: pointer;
  }
  .alternative-actions button:hover {
    border-color: var(--accent);
    color: var(--accent);
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
  @media (max-width: 1040px) {
    .stage-cockpit {
      grid-template-columns: 1fr;
    }
    .stage-side-column {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      align-items: start;
    }
  }
  @media (max-width: 740px) {
    .stage-command-strip {
      display: grid;
    }
    .assets-menu {
      margin-top: 0;
      justify-self: stretch;
    }
    .assets-menu summary {
      text-align: center;
    }
    .assets-menu-panel {
      left: 0;
      right: 0;
    }
    .stage-side-column {
      grid-template-columns: 1fr;
    }
    .slide {
      padding: 1.2rem;
      border-radius: 0.85rem;
      min-height: 0;
    }
    .slide-header,
    .deck-nav {
      align-items: stretch;
      flex-direction: column;
    }
    .deck-nav {
      gap: 0.6rem;
    }
    .nav-btn {
      width: 100%;
    }
    .slide-picker-grid {
      grid-template-columns: repeat(auto-fill, minmax(7.4rem, 1fr));
      gap: 0.65rem;
      padding: 0.8rem;
    }
    .version-history-list li > button {
      grid-template-columns: 1fr;
      gap: 0.32rem;
    }
    .version-history-list li strong {
      white-space: normal;
    }
  }
</style>
