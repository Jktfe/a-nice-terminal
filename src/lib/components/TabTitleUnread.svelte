<!--
  TabTitleUnread — prepend an unread counter to document.title when the
  tab is in the background. On focus/visibility regained, the counter
  zeroes and the original title is restored.

  The unread tally is opt-in: any code can dispatch a custom event on
  window:
    window.dispatchEvent(new CustomEvent('ant:notify-unread'));

  Each event increments the in-tab counter by one. The component listens
  globally so room views, asks pages, etc. can fire without coupling to
  a specific store. The MessageList SSE-driven new-message effect is
  the canonical caller wired in 178fea9; this component just consumes
  whatever dispatches.

  Counter resets to zero on `focus` or `visibilitychange (visible)`.
-->
<script lang="ts">
  import { onMount } from 'svelte';

  // CRASH FIX 2026-05-18: previous version installed a MutationObserver
  // on the <title> node that called syncTitle() on every mutation. SvelteKit
  // writes <svelte:head><title>…</title></svelte:head> on every navigation;
  // the observer fired, syncTitle re-wrote the title, the observer fired
  // again, and the JS thread locked. Even an EMPTY room hung because the
  // navigation alone triggers a title swap. The observer was an attempt
  // to "rewrap" the counter when the route-driven title swapped under us
  // — accepted minor edge case (counter loses prefix mid-background-nav)
  // to drop the loop entirely.

  let unreadCount = $state(0);
  let baseTitle = ''; // captured the first time we override the title

  function isHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  function applyCounterToTitle() {
    if (typeof document === 'undefined') return;
    if (unreadCount === 0) {
      if (baseTitle !== '' && document.title !== baseTitle) {
        document.title = baseTitle;
      }
      return;
    }
    if (baseTitle === '') {
      // Capture the current title (minus any stale `(N) ` from a prior
      // session) so we can restore it when the counter resets.
      baseTitle = document.title.replace(/^\(\d+\)\s*/, '');
    }
    const target = `(${unreadCount}) ${baseTitle}`;
    if (document.title !== target) document.title = target;
  }

  function handleNotifyUnread() {
    if (!isHidden()) return;
    unreadCount += 1;
    applyCounterToTitle();
  }

  function handleFocusOrVisible() {
    if (unreadCount === 0) return;
    unreadCount = 0;
    applyCounterToTitle();
  }

  onMount(() => {
    if (typeof document === 'undefined') return;

    window.addEventListener('ant:notify-unread', handleNotifyUnread);
    window.addEventListener('focus', handleFocusOrVisible);
    const visibilityHandler = () => {
      if (document.visibilityState === 'visible') handleFocusOrVisible();
    };
    document.addEventListener('visibilitychange', visibilityHandler);

    return () => {
      window.removeEventListener('ant:notify-unread', handleNotifyUnread);
      window.removeEventListener('focus', handleFocusOrVisible);
      document.removeEventListener('visibilitychange', visibilityHandler);
    };
  });
</script>
