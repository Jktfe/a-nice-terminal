<script>
  /** @type {{ variant: string, text: string }} */
  let { variant, text } = $props();

  const colours = $derived.by(() => {
    switch (variant.toUpperCase()) {
      case 'GET':
        return 'bg-emerald-500/20 text-emerald-400';
      case 'POST':
        return 'bg-blue-500/20 text-blue-400';
      case 'PATCH':
        return 'bg-amber-500/20 text-amber-400';
      case 'DELETE':
        return 'bg-red-500/20 text-red-400';
      case 'EVENT':
      case 'EMIT':
        return 'bg-purple-500/20 text-purple-400';
      default:
        return 'bg-white/[0.06] text-neutral-400';
    }
  });
</script>

<span class="inline-block rounded px-2 py-0.5 text-xs font-medium {colours}">
  {text}
</span>
