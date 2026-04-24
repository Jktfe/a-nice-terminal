<script lang="ts">
  let { opacity = 0.02 }: { opacity?: number } = $props();

  const grainUrl = "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'>
      <filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter>
      <rect width='100%' height='100%' filter='url(#n)' opacity='0.7'/>
    </svg>`
  );
</script>

<!-- Microscopic SVG noise — kills banding on dark surfaces -->
<div
  aria-hidden="true"
  class="absolute inset-0 pointer-events-none rounded-[inherit]"
  style="background-image: url(&quot;{grainUrl}&quot;); opacity: {opacity}; mix-blend-mode: overlay;"
></div>
