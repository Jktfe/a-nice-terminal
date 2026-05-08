<script lang="ts">
  import { useToasts } from '$lib/stores/toast.svelte';

  const toasts = useToasts();
  const visibleToasts = $derived(toasts.list.slice(-5));

  const kindIcon: Record<string, string> = {
    success: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    error: 'M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z',
    info: 'm11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z',
  };
</script>

<div
  class="ant-toast-container"
  role="region"
  aria-live="polite"
  aria-label="Notifications"
>
  {#each visibleToasts as t (t.id)}
    <div
      class="ant-toast ant-toast--{t.kind}"
      role={t.kind === 'error' ? 'alert' : 'status'}
      aria-live={t.kind === 'error' ? 'assertive' : 'polite'}
    >
      <span class="ant-toast-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path stroke-linecap="round" stroke-linejoin="round" d={kindIcon[t.kind]} />
        </svg>
      </span>
      <span>{t.message}</span>
      <button
        type="button"
        onclick={() => toasts.dismiss(t.id)}
        class="ant-toast-close"
        aria-label="Dismiss notification"
      >
        &times;
      </button>
    </div>
  {/each}
</div>

<style>
  .ant-toast-container {
    position: fixed;
    top: calc(1rem + var(--ant-safe-top, 0px));
    right: calc(1rem + var(--ant-safe-right, 0px));
    z-index: 200;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: min(400px, calc(100vw - 2rem - var(--ant-safe-left, 0px) - var(--ant-safe-right, 0px)));
    max-width: 400px;
    pointer-events: none;
  }

  .ant-toast {
    pointer-events: auto;
    display: grid;
    grid-template-columns: 1.25rem minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.75rem;
    padding: 0.875rem 0.95rem;
    border: 0.5px solid var(--hairline-strong);
    border-left-width: 4px;
    border-radius: var(--radius-card, 8px);
    background: color-mix(in srgb, var(--bg-card, #111827) 96%, transparent);
    color: var(--text-primary, #f3f4f6);
    box-shadow: 0 18px 40px -24px rgba(0, 0, 0, 0.55), 0 8px 18px -16px rgba(0, 0, 0, 0.45);
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.4;
    overflow-wrap: anywhere;
    animation: ant-toast-in 180ms ease-out;
  }

  .ant-toast--success {
    border-left-color: #10b981;
  }

  .ant-toast--error {
    border-left-color: #ef4444;
  }

  .ant-toast--info {
    border-left-color: #3b82f6;
  }

  .ant-toast-icon {
    display: inline-flex;
    width: 1.25rem;
    height: 1.25rem;
    margin-top: 0.05rem;
  }

  .ant-toast-icon svg {
    width: 100%;
    height: 100%;
  }

  .ant-toast--success .ant-toast-icon {
    color: #10b981;
  }

  .ant-toast--error .ant-toast-icon {
    color: #ef4444;
  }

  .ant-toast--info .ant-toast-icon {
    color: #3b82f6;
  }

  .ant-toast-close {
    min-width: 1.75rem;
    min-height: 1.75rem;
    margin: -0.25rem -0.3rem 0 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted, #9ca3af);
    cursor: pointer;
    font-size: 1.25rem;
    line-height: 1;
  }

  .ant-toast-close:hover,
  .ant-toast-close:focus-visible {
    background: var(--hairline, rgba(255, 255, 255, 0.08));
    color: var(--text-primary, #f3f4f6);
  }

  @keyframes ant-toast-in {
    from {
      opacity: 0;
      transform: translate3d(16px, -6px, 0);
    }
    to {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ant-toast {
      animation: none;
    }
  }

  @media (max-width: 640px) {
    .ant-toast-container {
      top: calc(0.75rem + var(--ant-safe-top, 0px));
      right: calc(0.75rem + var(--ant-safe-right, 0px));
      width: min(360px, calc(100vw - 1.5rem - var(--ant-safe-left, 0px) - var(--ant-safe-right, 0px)));
    }
  }
</style>
