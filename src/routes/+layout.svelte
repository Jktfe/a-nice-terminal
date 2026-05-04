<script>
  import '../app.css';
  import { theme } from '$lib/stores/theme.svelte';
  import ToastContainer from '$lib/components/ToastContainer.svelte';
  import { installAntViewportVars } from '$lib/utils/viewport';
  import { onMount } from 'svelte';

  let { children } = $props();

  onMount(() => {
    theme.init();
    return installAntViewportVars();
  });
</script>
{@render children()}
<ToastContainer />
