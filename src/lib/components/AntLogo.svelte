<!--
  Copied-from: ../a-nice-terminal/static/favicon.svg (the canonical ANT mark)
  Verdict: KEEP
  Simplification: replaced placeholder "A in coral box" with the real ant illustration.
  The detailed SVG renders as one image; this file just wraps it for sizing,
  optional wordmark, and accessible label.
-->
<script lang="ts">
  type Props = {
    label?: string;
    showWord?: boolean;
    size?: 'small' | 'medium' | 'large';
  };

  let {
    label = '>_ANT',
    showWord = true,
    size = 'medium'
  }: Props = $props();
</script>

<!--
  NAV-POLISH 2026-05-14 — JWPK D2.6 FINAL logo spec (third refinement):
  the wordmark is a terminal-prompt cursor reading `>_ANT` left-to-right:
    `>` greater-than — terminal prompt symbol, BLUE (var --info)
    `_` underscore   — blinking cursor line, GREEN (var --ok)
    `ANT` letters    — brand name, ADAPTIVE foreground (var --ink-strong)
                       which resolves to black on light theme + white on
                       dark theme via the :root[data-theme='dark']
                       override in app.css.
  Wordmark sits LEFT of the icon glyph per D1.4.
-->
<div class="ant-logo" aria-label={label} data-size={size}>
  {#if showWord}
    <span class="ant-word">
      <span class="ant-word-prompt">&gt;</span><span class="ant-word-cursor">_</span><span class="ant-word-name">ANT</span>
    </span>
  {/if}
  <img class="ant-mark" src="/ant-logo.svg" alt="" width="48" height="48" />
</div>

<style>
  .ant-logo {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    font-weight: 900;
    color: var(--ink-strong);
  }

  .ant-mark {
    display: block;
    flex-shrink: 0;
  }

  .ant-logo[data-size='small'] .ant-mark {
    width: 1.75rem;
    height: 1.75rem;
  }

  .ant-logo[data-size='medium'] .ant-mark {
    width: 2.35rem;
    height: 2.35rem;
  }

  .ant-logo[data-size='large'] .ant-mark {
    width: 3.5rem;
    height: 3.5rem;
  }

  .ant-word {
    font-size: 1.15rem;
    letter-spacing: 0.06em;
  }

  /* Blue prompt — `>` per JWPK D2.6, terminal prompt symbol. --info
     is the fresh-ANT semantic-blue token. */
  .ant-word-prompt {
    color: var(--info);
  }

  /* Green underscore reads as terminal-prompt cursor. --ok is the
     fresh-ANT semantic-green token; same value across light + dark. */
  .ant-word-cursor {
    color: var(--ok);
  }

  /* ANT letters — adaptive foreground per JWPK D2.4: black on light,
     white on dark. --ink-strong is the fresh-ANT adaptive
     foreground-on-background token (resolves to #181512 in light theme
     and #f7ffe8 in dark theme via :root[data-theme='dark']). */
  .ant-word-name {
    color: var(--ink-strong);
  }

  .ant-logo[data-size='small'] .ant-word {
    font-size: 0.95rem;
  }

  .ant-logo[data-size='large'] .ant-word {
    font-size: 1.6rem;
  }
</style>
