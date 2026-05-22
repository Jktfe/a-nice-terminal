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
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import { renderMarkdown } from '$lib/chat/renderMarkdown';
  import { resolvePreferredProvider, type TTSHandle } from '$lib/voice/interview-tts';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let activeIndex = $state(0);
  let inspectMode = $state(false);
  let shareNotice = $state('');
  let lastPublishedFocusRef = '';
  let speakingIndex = $state<number | null>(null);
  let currentTTSHandle: TTSHandle | null = null;

  const deck = $derived(data.deck);
  const slides = $derived(deck.slides ?? []);
  const slideCount = $derived(slides.length);
  const activeSlide = $derived(slides[activeIndex]);
  const renderedBody = $derived(activeSlide ? renderMarkdown(activeSlide.content) : '');

  function clampedSet(next: number): void {
    if (slideCount === 0) return;
    const clamped = Math.max(0, Math.min(slideCount - 1, next));
    stopSpeaking();
    activeIndex = clamped;
    void publishStageFocus(clamped);
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
  }

  async function speakCurrentSlide(): Promise<void> {
    if (!activeSlide) return;
    if (speakingIndex === activeIndex && currentTTSHandle) {
      stopSpeaking();
      return;
    }
    stopSpeaking();
    // Narration precedence (per JWPK deck-voice-spec 2026-05-22):
    //  1. slide.narration — explicit TTS-only voice line
    //  2. slide.speakerNotes — written presenter notes (also fine for TTS)
    //  3. slide.content — on-slide bullets (last resort; you don't read off the slide)
    const slideAny = activeSlide as { narration?: string; speakerNotes?: string };
    const narration =
      slideAny.narration ?? slideAny.speakerNotes ?? activeSlide.content ?? '';
    if (narration.trim().length === 0) return;
    try {
      const provider = await resolvePreferredProvider();
      const handle = provider.speak(narration);
      currentTTSHandle = handle;
      const indexAtStart = activeIndex;
      speakingIndex = indexAtStart;
      handle.onStart = () => { speakingIndex = indexAtStart; };
      handle.onEnd = () => {
        if (currentTTSHandle === handle) {
          currentTTSHandle = null;
          speakingIndex = null;
        }
      };
    } catch {
      speakingIndex = null;
      currentTTSHandle = null;
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
      const response = await fetch(`/api/decks/${encodeURIComponent(deck.id)}/stage-focus`, {
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
  <div class="deck-toolbar" role="toolbar" aria-label="Deck controls">
    <a class="back" href={`/rooms/${encodeURIComponent(deck.roomId)}`}>← Back to room</a>
    <span class="deck-spacer"></span>
    <button type="button" class="toolbar-btn" onclick={() => (inspectMode = !inspectMode)} aria-pressed={inspectMode}>
      {inspectMode ? 'Hide JSON' : 'Inspect JSON'}
      <kbd>I</kbd>
    </button>
    <button type="button" class="toolbar-btn" onclick={speakCurrentSlide} aria-pressed={speakingIndex === activeIndex}>
      {speakingIndex === activeIndex ? 'Stop narration' : 'Speak slide'}
    </button>
    <button type="button" class="toolbar-btn" onclick={copyShareLink}>
      Copy share link
    </button>
  </div>

  {#if shareNotice}
    <p class="share-notice" role="status">{shareNotice}</p>
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
        <h2 class="slide-title">{activeSlide.title}</h2>
        <span class="slide-counter">Slide {activeIndex + 1} of {slideCount}</span>
      </header>
      <div class="slide-body">{@html renderedBody}</div>
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
    </nav>
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
  .back {
    display: inline-block;
    color: var(--ink-soft);
    text-decoration: none;
    font-weight: 700;
    font-size: 0.85rem;
  }
  .back:hover { color: var(--accent); }
  .deck-toolbar {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.55rem 0;
    margin-bottom: 1rem;
  }
  .deck-spacer { flex: 1; }
  .toolbar-btn {
    padding: 0.45rem 0.85rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--ink-strong);
    font: inherit;
    font-weight: 800;
    font-size: 0.82rem;
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s;
  }
  .toolbar-btn:hover { border-color: var(--accent); color: var(--accent); }
  .toolbar-btn[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); }
  .toolbar-btn kbd {
    display: inline-block;
    margin-left: 0.4rem;
    padding: 0.05rem 0.35rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.3rem;
    background: var(--bg);
    color: var(--ink-soft);
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.7rem;
  }
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
  .slide-body {
    flex: 1;
    color: var(--ink-strong);
    line-height: 1.55;
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
