<!--
  AntPathAnimation.svelte
  Svelte 5 wrapper component for the vanilla AntWalker brand primitive.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { AntWalker } from '../ant-motion/ant-motion';

  type Props = {
    pathStyle?: 'sCurve' | 'loop' | 'orbit' | 'zig' | 'custom';
    customPath?: string;
    endMode?: 'reset' | 'fade' | 'reverse' | 'stay';
    antCount?: number;
    spacing?: number; // spacing in % (e.g. 7.5)
    duration?: number; // duration in ms
    palette?: string[]; // array of hex colors for eye cycling
    bodyColor?: string;
    outlineColor?: string;
    routeColor?: string;
    antScale?: number;
    leaderEnabled?: boolean;
    leaderColor?: string;
    leaderScale?: number;
    showControls?: boolean;
    showPath?: boolean;
    spritesheetPath?: string;
  };

  let {
    pathStyle = 'sCurve',
    customPath = '',
    endMode = 'reset',
    antCount = 12,
    spacing = 7.5,
    duration = 9000,
    palette = ['#7cff2e', '#25d473', '#00d4ff'],
    bodyColor = '#0a253c',
    outlineColor = '#f3faf4',
    routeColor = '#7cff2e',
    antScale = 0.44,
    leaderEnabled = true,
    leaderColor = '#baff55',
    leaderScale = 1.32,
    showControls = false,
    showPath = false,
    spritesheetPath = '/ant-spritesheet.png'
  }: Props = $props();

  // Initialize local states with literal defaults to avoid state-capture warnings
  let localPathStyle = $state<'sCurve' | 'loop' | 'orbit' | 'zig' | 'custom'>('sCurve');
  let localEndMode = $state<'reset' | 'fade' | 'reverse' | 'stay'>('reset');
  let localAntCount = $state(12);
  let localSpacing = $state(7.5);
  let localDuration = $state(9000);
  let localPaletteRaw = $state('#7cff2e, #25d473, #00d4ff');
  let localBodyColor = $state('#0a253c');
  let localOutlineColor = $state('#f3faf4');
  let localRouteColor = $state('#7cff2e');
  let localAntScale = $state(0.44);
  let localLeaderEnabled = $state(true);
  let localLeaderColor = $state('#baff55');
  let localLeaderScale = $state(1.32);
  let localShowPath = $state(false);
  let localSpritesheetPath = $state('/ant-spritesheet.png');

  // Sync props reactively to local state when props change
  $effect(() => {
    localPathStyle = pathStyle;
    localEndMode = endMode;
    localAntCount = antCount;
    localSpacing = spacing;
    localDuration = duration;
    localPaletteRaw = palette.join(', ');
    localBodyColor = bodyColor;
    localOutlineColor = outlineColor;
    localRouteColor = routeColor;
    localAntScale = antScale;
    localLeaderEnabled = leaderEnabled;
    localLeaderColor = leaderColor;
    localLeaderScale = leaderScale;
    localShowPath = showPath;
    localSpritesheetPath = spritesheetPath;
  });

  const paths = {
    sCurve: "M80 455 C205 85 395 120 505 310 S755 555 920 135",
    loop: "M130 315 C130 105 390 105 498 315 C607 525 870 525 870 315 C870 105 607 105 498 315 C390 525 130 525 130 315",
    orbit: "M150 315 C150 110 365 105 500 260 C635 420 852 395 858 238 C864 80 655 115 500 315 C345 515 145 475 150 315",
    zig: "M75 140 C180 255 275 250 382 130 C492 8 580 55 655 175 C725 286 815 350 930 252"
  };

  const activePathD = $derived(
    localPathStyle === 'custom' && customPath ? customPath : (paths[localPathStyle as keyof typeof paths] || paths.sCurve)
  );

  const parsedPalette = $derived.by(() => {
    const values = localPaletteRaw
      .split(",")
      .map(x => x.trim())
      .filter(Boolean)
      .filter(x => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(x));
    return values.length ? values : ["#7cff2e"];
  });

  let svgEl: SVGElement | null = $state(null);
  let walker: AntWalker | null = null;

  onMount(() => {
    if (svgEl) {
      walker = new AntWalker(svgEl, {
        pathD: activePathD,
        endMode: localEndMode,
        antCount: localAntCount,
        spacing: localSpacing,
        duration: localDuration,
        palette: parsedPalette,
        bodyColor: localBodyColor,
        outlineColor: localOutlineColor,
        routeColor: localRouteColor,
        antScale: localAntScale,
        leaderEnabled: localLeaderEnabled,
        leaderColor: localLeaderColor,
        leaderScale: localLeaderScale,
        showPath: localShowPath,
        spritesheetPath: localSpritesheetPath
      });
    }
  });

  onDestroy(() => {
    if (walker) {
      walker.destroy();
    }
  });

  // Update vanilla walker settings reactively when local states change
  $effect(() => {
    if (walker) {
      walker.updateOptions({
        pathD: activePathD,
        endMode: localEndMode,
        antCount: localAntCount,
        spacing: localSpacing,
        duration: localDuration,
        palette: parsedPalette,
        bodyColor: localBodyColor,
        outlineColor: localOutlineColor,
        routeColor: localRouteColor,
        antScale: localAntScale,
        leaderEnabled: localLeaderEnabled,
        leaderColor: localLeaderColor,
        leaderScale: localLeaderScale,
        showPath: localShowPath,
        spritesheetPath: localSpritesheetPath
      });
    }
  });

  function restart() {
    if (walker) {
      walker.startAnimation();
    }
  }
</script>

<div
  class="ant-animation-container"
  class:with-controls={showControls}
  style="--line: {localRouteColor}bb; --border: rgba(255, 255, 255, 0.13);"
>
  <section class="stage" aria-label="Ant animation stage">
    <!-- AntWalker mounts paths and SVG ants inside this node -->
    <svg bind:this={svgEl} viewBox="0 0 1000 620" preserveAspectRatio="xMidYMid meet">
    </svg>
  </section>

  {#if showControls}
    <aside class="controls">
      <h2 class="control-title">Controls</h2>
      
      <div class="control">
        <label for="pathStyle">Path shape</label>
        <select id="pathStyle" bind:value={localPathStyle}>
          <option value="sCurve">S-curve march</option>
          <option value="loop">Loop / figure-eight</option>
          <option value="orbit">Colony orbit</option>
          <option value="zig">Zig-zag sprint</option>
          {#if customPath}
            <option value="custom">Custom path</option>
          {/if}
        </select>
      </div>

      <div class="control">
        <label for="endMode">End behaviour</label>
        <select id="endMode" bind:value={localEndMode}>
          <option value="reset">Reset / loop</option>
          <option value="fade">Fade out then reset</option>
          <option value="reverse">Reverse / ping-pong</option>
          <option value="stay">Stay at end</option>
        </select>
      </div>

      <div class="control">
        <label for="antCount">
          Ant count <span class="value">{localAntCount}</span>
        </label>
        <input id="antCount" type="range" min="1" max="52" bind:value={localAntCount} />
      </div>

      <div class="control">
        <label for="spacing">
          Spacing <span class="value">{Number(localSpacing).toFixed(1)}%</span>
        </label>
        <input id="spacing" type="range" min="2" max="11" step="0.5" bind:value={localSpacing} />
      </div>

      <div class="control">
        <label for="duration">
          Duration <span class="value">{localDuration}ms</span>
        </label>
        <input id="duration" type="range" min="3000" max="20000" step="500" bind:value={localDuration} />
      </div>

      <div class="control">
        <label for="palette">Eye palette</label>
        <input id="palette" type="text" bind:value={localPaletteRaw} />
        <p class="hint">Comma-separated hex colors.</p>
      </div>

      <div class="control-row">
        <div>
          <label for="bodyColor">Body</label>
          <input id="bodyColor" type="color" bind:value={localBodyColor} />
        </div>
        <div>
          <label for="outlineColor">Outline</label>
          <input id="outlineColor" type="color" bind:value={localOutlineColor} />
        </div>
      </div>

      <div class="control-row">
        <div>
          <label for="routeColor">Route</label>
          <input id="routeColor" type="color" bind:value={localRouteColor} />
        </div>
        <div>
          <label for="antScale">Ant size</label>
          <input id="antScale" type="range" min="0.24" max="0.52" step="0.01" bind:value={localAntScale} />
        </div>
      </div>

      <div class="control">
        <div class="switchline">
          <label for="showPath">Show route path</label>
          <input id="showPath" type="checkbox" bind:checked={localShowPath} />
        </div>
      </div>

      <div class="control">
        <div class="switchline">
          <label for="leaderEnabled">Leader ant</label>
          <input id="leaderEnabled" type="checkbox" bind:checked={localLeaderEnabled} />
        </div>
      </div>

      {#if localLeaderEnabled}
        <div class="control-row">
          <div>
            <label for="leaderColor">Leader color</label>
            <input id="leaderColor" type="color" bind:value={localLeaderColor} />
          </div>
          <div>
            <label for="leaderScale">Leader scale</label>
            <input id="leaderScale" type="range" min="1" max="1.75" step="0.02" bind:value={localLeaderScale} />
          </div>
        </div>
      {/if}

      <button onclick={restart}>Restart preview</button>
    </aside>
  {/if}
</div>

<style>
  :global {
    @import "../ant-motion/ant-motion.css";
  }
</style>
