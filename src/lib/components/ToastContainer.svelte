<script lang="ts">
  import { useToasts } from '$lib/stores/toast.svelte';

  const toasts = useToasts();

  const kindStyle: Record<string, string> = {
    success: 'border-[#22C55E55] bg-[#22C55E15] text-[#22C55E]',
    error:   'border-[#EF444455] bg-[#EF444415] text-[#EF4444]',
    info:    'border-[#6366F155] bg-[#6366F115] text-[#6366F1]',
  };
  const kindIcon: Record<string, string> = { success: '✓', error: '✕', info: 'ℹ' };
</script>

<div
  class="fixed bottom-5 right-5 z-[200] flex flex-col gap-2 pointer-events-none"
  style="padding-bottom: var(--ant-safe-bottom, 0px); padding-right: var(--ant-safe-right, 0px);"
  role="region"
  aria-live="polite"
  aria-label="Notifications"
>
  {#each toasts.list as t (t.id)}
    <div
      class="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-sm font-medium shadow-lg pointer-events-auto
             animate-in slide-in-from-right-4 fade-in duration-200"
      class:border-[#22C55E55]={t.kind === 'success'}
      class:bg-[#22C55E15]={t.kind === 'success'}
      class:text-[#22C55E]={t.kind === 'success'}
      class:border-[#EF444455]={t.kind === 'error'}
      class:bg-[#EF444415]={t.kind === 'error'}
      class:text-[#EF4444]={t.kind === 'error'}
      class:border-[#6366F155]={t.kind === 'info'}
      class:bg-[#6366F115]={t.kind === 'info'}
      class:text-[#6366F1]={t.kind === 'info'}
      role={t.kind === 'error' ? 'alert' : 'status'}
    >
      <span class="text-base leading-none" aria-hidden="true">{kindIcon[t.kind]}</span>
      <span>{t.message}</span>
      <button
        onclick={() => toasts.dismiss(t.id)}
        class="touch-target ml-1 opacity-60 hover:opacity-100 text-xs leading-none"
        aria-label="Dismiss notification"
      >✕</button>
    </div>
  {/each}
</div>
