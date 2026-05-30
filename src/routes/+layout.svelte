<script lang="ts">
  import '../app.css';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import KeyboardShortcutsOverlay from '$lib/components/KeyboardShortcutsOverlay.svelte';
  import QuickNavShortcuts from '$lib/components/QuickNavShortcuts.svelte';
  import TabTitleUnread from '$lib/components/TabTitleUnread.svelte';
  import LogoutButton from '$lib/components/LogoutButton.svelte';

  let { children } = $props();
</script>

<a class="skip-link" href="#main-content">Skip to main content</a>
{@render children()}
<CommandPalette />
<KeyboardShortcutsOverlay />
<QuickNavShortcuts />
<TabTitleUnread />
<LogoutButton />
