<script lang="ts">
  import { NOCTURNE } from '$lib/nocturne';

  let {
    isDark = true,
    children,
  }: {
    isDark?: boolean;
    children?: import('svelte').Snippet;
  } = $props();
</script>

<code
  style="
    font-family: var(--font-mono);
    font-size: 0.88em;
    letter-spacing: 0;
    padding: 1px 5px;
    border-radius: 4px;
    background: {isDark ? 'rgba(66,133,244,0.14)' : 'rgba(59,130,246,0.10)'};
    color: {isDark ? NOCTURNE.blue[300] : NOCTURNE.blue[700]};
    border: 0.5px solid {isDark ? 'rgba(66,133,244,0.25)' : 'rgba(59,130,246,0.20)'};
  "
>{#if children}{@render children()}{/if}</code>
