<script lang="ts">
  import { NOCTURNE } from '$lib/nocturne';

  let {
    text = 'Thinking',
  }: {
    text?: string;
  } = $props();
</script>

<div class="flex items-center gap-1.5">
  <div
    class="rounded-full animate-breathe"
    style="
      width: 6px;
      height: 6px;
      background: linear-gradient(135deg, {NOCTURNE.pulse.hot} 0%, {NOCTURNE.pulse.mid} 50%, {NOCTURNE.pulse.deep} 100%);
      animation-duration: 1.6s;
    "
  ></div>
  <span
    class="animate-shimmer"
    style="
      font-size: 11.5px;
      font-family: var(--font-mono);
      letter-spacing: 0;
      background: linear-gradient(90deg, {NOCTURNE.pulse.deep} 0%, {NOCTURNE.pulse.hot} 50%, {NOCTURNE.pulse.deep} 100%);
      background-size: 200% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
    "
  >{text}</span>
</div>
