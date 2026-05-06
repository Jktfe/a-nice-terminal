<script lang="ts">
  import { onMount } from 'svelte';
  import { NOCTURNE } from '$lib/nocturne';

  interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
    prompt(): Promise<void>;
  }

  let deferredPrompt = $state<BeforeInstallPromptEvent | null>(null);
  let showPrompt = $state(false);
  let installed = $state(false);

  onMount(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e as BeforeInstallPromptEvent;
      showPrompt = true;
    };

    window.addEventListener('beforeinstallprompt', handler);

    window.addEventListener('appinstalled', () => {
      installed = true;
      showPrompt = false;
      deferredPrompt = null;
    });

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      installed = true;
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  });

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      installed = true;
    }
    deferredPrompt = null;
    showPrompt = false;
  }

  function dismiss() {
    showPrompt = false;
  }
</script>

{#if showPrompt && !installed}
  <div
    class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border"
    style="background: var(--bg-card); border-color: var(--border-light); max-width: 90vw;"
  >
    <div class="flex-1 min-w-0">
      <p class="text-sm font-medium truncate" style="color: var(--text);">Install ANT</p>
      <p class="text-xs truncate" style="color: var(--text-muted);">Add to home screen for quick access</p>
    </div>
    <button
      onclick={handleInstall}
      class="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
      style="background: {NOCTURNE.blue[500]}; color: #fff;"
    >
      Install
    </button>
    <button
      onclick={dismiss}
      class="p-1.5 rounded cursor-pointer"
      style="color: var(--text-faint); background: transparent; border: none;"
      aria-label="Dismiss"
    >
      ✕
    </button>
  </div>
{/if}
