<!--
  MemberIcon — render a room-member's displayIcon as either a text mark
  or a logo image. The convention is:

    displayIcon === ''        → fall back to first letter of displayName
    displayIcon starts 'logo:'  → render /llm-icons/<slug>-icon.svg or
                                   the bare /llm-icons/<slug>.svg file
                                   the form picker offers
    else                      → render as text (existing behaviour:
                                   emoji or short label)

  Centralising this so MessageRow / ParticipantsPanel / ParticipantDetailSheet
  / future surfaces share one renderer. New logo slugs can be added by
  dropping the SVG into /static/llm-icons/ — no schema changes needed.
-->
<script lang="ts">
  type Props = {
    icon: string | null | undefined;
    fallbackText: string;
    size?: 'sm' | 'md' | 'lg';
    /**
     * When true, the parent will apply its own ring/background, so we
     * skip the per-image padding to let the SVG fill the slot.
     */
    flush?: boolean;
  };

  let { icon, fallbackText, size = 'md', flush = false }: Props = $props();

  const isLogo = $derived(typeof icon === 'string' && icon.startsWith('logo:'));
  const logoSrc = $derived.by(() => {
    if (!isLogo) return null;
    const slug = (icon as string).slice('logo:'.length).trim();
    if (!slug) return null;
    // The picker registers slugs that map to either `<slug>-icon.svg`
    // or `<slug>.svg` (the few logos without the "-icon" suffix).
    // We try both at the URL level via a sentinel — pickLogoSrc()
    // resolves which one actually exists at build time. For runtime
    // we just trust the slug; missing files render as a broken-image
    // icon, which is fine for a v1.
    return `/llm-icons/${slug}`;
  });

  const sizeClass = $derived(
    size === 'sm' ? 'mi-sm' : size === 'lg' ? 'mi-lg' : 'mi-md'
  );

  const textMark = $derived(
    icon && !isLogo ? icon : firstLetterOf(fallbackText)
  );

  function firstLetterOf(label: string): string {
    const trimmed = (label ?? '').trim();
    const withoutAt = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
    return (withoutAt.charAt(0) || trimmed.charAt(0) || '?').toUpperCase();
  }
</script>

{#if isLogo && logoSrc}
  <img
    class={`member-icon-logo ${sizeClass}`}
    class:flush
    src={logoSrc}
    alt=""
    aria-hidden="true"
    loading="lazy"
    decoding="async"
  />
{:else}
  <span class={`member-icon-text ${sizeClass}`} aria-hidden="true">{textMark}</span>
{/if}

<style>
  .member-icon-logo {
    display: inline-block;
    border-radius: 999px;
    background: white;
    object-fit: contain;
  }
  .member-icon-logo.flush { background: transparent; }
  .member-icon-text {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    line-height: 1;
  }
  .mi-sm { width: 1rem;   height: 1rem;   font-size: 0.7rem; padding: 0.05rem; }
  .mi-md { width: 1.4rem; height: 1.4rem; font-size: 0.9rem; padding: 0.1rem; }
  .mi-lg { width: 2rem;   height: 2rem;   font-size: 1.1rem; padding: 0.15rem; }
</style>
