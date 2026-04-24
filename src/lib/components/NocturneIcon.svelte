<script lang="ts">
  let {
    name,
    size = 14,
    color = 'currentColor',
  }: {
    name: string;
    size?: number;
    color?: string;
  } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke={color}
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  {#if name === 'arrowRight'}
    <path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>
  {:else if name === 'send'}
    <path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4 20-7z"/>
  {:else if name === 'reply'}
    <path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
  {:else if name === 'check'}
    <path d="M20 6 9 17l-5-5"/>
  {:else if name === 'x'}
    <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
  {:else if name === 'play'}
    <path d="m6 3 14 9-14 9V3z"/>
  {:else if name === 'cornerDown'}
    <path d="M9 10 4 15l5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>
  {:else if name === 'moreHorizontal'}
    <circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>
  {:else if name === 'terminal'}
    <path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>
  {:else if name === 'cpu'}
    <rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/>
    <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>
  {:else if name === 'cloud'}
    <path d="M17.5 19H9a6 6 0 1 1 .6-11.97 8 8 0 0 1 15.26 4.47A5 5 0 0 1 17.5 19Z"/>
  {:else if name === 'sparkle'}
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>
  {/if}
</svg>
