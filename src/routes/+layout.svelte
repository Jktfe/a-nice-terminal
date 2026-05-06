<script>
  import '../app.css';
  import { theme } from '$lib/stores/theme.svelte';
  import ToastContainer from '$lib/components/ToastContainer.svelte';
  import PwaInstallPrompt from '$lib/components/PwaInstallPrompt.svelte';
  import { installAntViewportVars } from '$lib/utils/viewport';
  import { onMount } from 'svelte';

  let { children } = $props();

  onMount(() => {
    theme.init();

    // M6 #2 — Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('[PWA] Service Worker registered:', reg.scope);
        })
        .catch((err) => {
          console.error('[PWA] Service Worker registration failed:', err);
        });
    }

    return installAntViewportVars();
  });
</script>
{@render children()}
<ToastContainer />
<PwaInstallPrompt />
