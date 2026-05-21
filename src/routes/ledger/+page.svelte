<!--
  /ledger — back-compat redirect to Settings home (Activity tab) per
  Settings Home design contract (2026-05-14) Q6. Original capability
  ledger content lives at /settings#activity.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  onMount(() => { location.replace('/settings#activity'); });
</script>

<p>Ledger has moved into <a href="/settings#activity">Settings → Activity</a>.</p>
