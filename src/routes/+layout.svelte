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

    if ('serviceWorker' in navigator) {
      let reloadingForServiceWorkerUpdate = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadingForServiceWorkerUpdate) return;
        reloadingForServiceWorkerUpdate = true;
        window.location.reload();
      });

      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then((reg) => {
          console.log('[PWA] Service Worker registered:', reg.scope);
          void reg.update();

          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }

          reg.addEventListener('updatefound', () => {
            const worker = reg.installing;
            if (!worker) return;
            worker.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                worker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });
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
