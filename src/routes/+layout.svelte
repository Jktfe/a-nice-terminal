<script>
  import '../app.css';
  import { theme } from '$lib/stores/theme.svelte';
  import ToastContainer from '$lib/components/ToastContainer.svelte';
  import { onMount } from 'svelte';

  let { children } = $props();

  onMount(() => {
    theme.init();
  });
</script>
{@render children()}
<ToastContainer />
