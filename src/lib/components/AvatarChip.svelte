<script lang="ts">
  /**
   * AvatarChip — circular initial-chip for a room member or session participant.
   *
   * Renders the first letter after the leading `@` (so "@codex" → "C"). The
   * background colour is deterministic from the handle string via a tiny
   * djb2 hash → HSL hue, so the same handle always lands on the same hue.
   * Saturation + lightness are tuned to keep white text legible against the
   * chip in both light and dark themes (lightness floor of 38%).
   *
   * Sizing: `sm` = 1.5rem; `md` = 2rem. Default = `md`.
   *
   * Hover affordance is provided via the native `title` attribute (handle +
   * optional displayName). A richer styled tooltip can land later — keep this
   * component dependency-free for now.
   */

  type Props = {
    handle: string;
    displayName?: string;
    size?: 'sm' | 'md';
  };

  let { handle, displayName, size = 'md' }: Props = $props();

  const trimmedHandle = $derived(handle.trim());

  // First character after the leading "@". Fallback to the first character of
  // the raw handle so empty/no-@ inputs don't render an empty chip.
  const initial = $derived.by(() => {
    const afterAt = trimmedHandle.startsWith('@')
      ? trimmedHandle.slice(1)
      : trimmedHandle;
    const firstChar = afterAt.charAt(0) || trimmedHandle.charAt(0) || '?';
    return firstChar.toUpperCase();
  });

  // djb2-style hash → 0..359 hue. Deterministic per-handle.
  function hashHandleToHue(input: string): number {
    let hash = 5381;
    for (let i = 0; i < input.length; i += 1) {
      hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 360;
  }

  const hue = $derived(hashHandleToHue(trimmedHandle));

  // 62% saturation + 42% lightness keeps white text legible in both themes
  // without leaning on data-theme branching for the background colour itself.
  const background = $derived(`hsl(${hue} 62% 42%)`);

  const tooltip = $derived(
    displayName && displayName !== trimmedHandle
      ? `${trimmedHandle} (${displayName})`
      : trimmedHandle
  );

  const sizeClass = $derived(size === 'sm' ? 'avatar-chip-sm' : 'avatar-chip-md');
</script>

<span
  class="avatar-chip {sizeClass}"
  style:background-color={background}
  title={tooltip}
  aria-label={tooltip}
>
  {initial}
</span>

<style>
  .avatar-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    color: white;
    font-weight: 800;
    line-height: 1;
    user-select: none;
    border: 1px solid var(--line-soft, rgba(0, 0, 0, 0.12));
    box-sizing: border-box;
    flex-shrink: 0;
  }

  .avatar-chip-sm {
    width: 1.5rem;
    height: 1.5rem;
    font-size: 0.75rem;
  }

  .avatar-chip-md {
    width: 2rem;
    height: 2rem;
    font-size: 0.95rem;
  }

  /* Dark-mode border: softer line to match SimplePageShell vocabulary. */
  :global(:root[data-theme='dark']) .avatar-chip {
    border-color: rgba(255, 255, 255, 0.18);
  }
</style>
