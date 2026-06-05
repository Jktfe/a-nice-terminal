/**
 * ant-motion.ts
 * Framework-free TypeScript engine for the ANT brand path animation.
 * Can be mounted on any SVG element in raw HTML explainers, decks, docs, or Svelte views.
 */

export interface AntWalkerOptions {
  pathD?: string;
  endMode?: 'reset' | 'fade' | 'reverse' | 'stay';
  antCount?: number;
  spacing?: number; // spacing in percent (e.g. 7.5%)
  duration?: number; // duration in ms
  palette?: string[];
  bodyColor?: string;
  outlineColor?: string;
  routeColor?: string;
  antScale?: number;
  leaderEnabled?: boolean;
  leaderColor?: string;
  leaderScale?: number;
  showPath?: boolean;
  spritesheetPath?: string;
}

export interface AntItem {
  node: SVGElement;
  index: number;
  scale: number;
}

const ANT_PATHS = [
  { kind: "outline", d: "m134.4 105c5.7-1.4 16.4-4.2 15.5-15-1-12.9-10.3-29.1-21.6-34.4-9.3-4.2-28.1-3.7-37.3 5.9-1.1 1.1-1.9 2.3-2.5 3.6-2.6-2.6-6.6-5.4-10.4-6.5-3.6-1.2-8.8-2.3-16.1-0.5-2.4-6.7-9.1-14.4-23.4-15.5-2.5-8.7-9.6-22.6-20.3-23.5-5.8-0.5-9.3 4.2-7.3 9.1-5.6-1.3-10.1-1.4-11 2.8-1.3 5.6 1.6 8.9 7.1 11 4.4 1.2 7.6 0.1 11.2 3.5 1 1 1.9 2.2 2.5 3.6-6.9 5.3-12.6 14.4-13.7 23.9-0.8 7.1 0.2 17.3 5.5 21.1 1.5 1.1 3.5 2 6.3 2 5.1 0.1 12.6-1.3 17.4-2.4-1.2 3.4-3.9 10.4-4.8 11.7-2.4 1.9-7.7 2.3-10 3.8-4.8 3-2.5 7.4-1 8.5-3 1.4-5.9 1.3-8.1 4-2.9 3.5-0.7 9.1 4.6 8.8 1.2 0 4.2-0.9 5.4-1.1 7.3-1.6 11-3.1 14.4-7 2.6-2.9 4.3-6.5 5.5-8.2 1.4-1.7 5.1-4.4 9.5-13.6 2.7 1.6 7.3 3.8 11.6 4.3 1.5 0 3-0.1 3.9-0.8 0 4.7-1.5 10-4.8 13-2.9 2.6-7.9 4.3-7.5 8.6 0.3 3.4 4.1 6.2 8.4 4.7 5.7-2.1 9.3-4 11.1-5.9 1.8-1.8 3.1-4.3 3.5-7.1 9.4 0 11.9-9.5 14.4-20.8 2.7 1.1 6.2 2.5 9.7 2.1 1.8 2.2 5.6 3 6.8 4.2 2 1.9 2.8 11.7 9.6 15.6 2.5 1.5 8.2 3.2 11.6 1.1 3.5 4.8 7 7.4 12.4 8.9 2.4 0.7 4.4 1.9 7.9 1.7 5.6-0.6 3.7-8-0.3-10l-4.2-2c-2-0.8-7.4-4.5-9.3-7.7-0.6-0.9-2.2-3.9-2.5-4.8l0.3-0.7z" },
  { kind: "body", d: "m37.2 46.5c-1.6 0.3-1.6 0.1-2.6-3.6-2.7-8.9-8.7-17.8-16-19.4-7.6-1.6-3.1 7.4 4.5 12.4 3 1.8 3.9 1.8 5.9 6.5 3.6 8.1 0.7 8.5-1.4 4.4-7.1-9.6-15-13.9-21.5-14.3-3.6-0.3-4.1 1.2-4.1 2.5 0.1 2.9 6 3.6 12 4.2 4.6 0.3 11.6 7.4 10.3 12.3-0.4 1.1-2.7 2.1-3.2 2.9-6.4 5.5-10.6 14.6-10.6 23.6 0 4 0.9 10.1 3.2 12.6 1.3 1.3 2.9 1.8 4.8 1.8 5.2 0.1 12.5-1.4 17.1-2.7 7-2 14.3-4.8 18.6-10.3 6.7-8.2 6.7-19.5-0.2-26.5-3-2.8-8.5-6.4-16.8-6.4z" },
  { kind: "body", d: "m61.6 63c0 6.2-2.2 13.7-7.7 19.5-1.3 1.4 2 3.4 4.1 4.9 5.1 3.1 6 1.6 6 4.7 0 4.1-1.1 1.4-4.4-0.2-3.5-1.9-9.1-3.5-13-3.5-1.5 0-3 0.7-4.1 2.5-1.9 3.2-4.9 13.2-7.4 17.2-2.6 3-11.9 4.4-12 5.9 0.8 2.7 5.3 0.5 7.4 1.4-0.9 1.1-4.9 5.6-13 7.8-2.3 0.7-3.4 3.3-0.6 3 9.5-2 12.6-2.5 16.2-6.5 2.8-3.2 4.6-7.1 5.8-8.3 2.8-2.8 7.3-7.4 10-13.7 0.8-2.2 1.1-4 3.1-2.6 1.9 1.4 7.4 4.8 11.4 5.3 4.2 0.5 5.2-5.9 6-11.5 0.2-3.3 1.3-7.4 5.6-7.8 3.5-0.1 5.7 3.3 6.6 5.4 0.9 1.9 1 2 5.1-2.6 1.8-2.5 4.5 0.1 4.6-2.3l-0.4-3.6-0.3-3.9c-0.2-1.1-1.1 0.3-2.2-1.6-3.8-5.6-10.5-11.4-19.3-11.3-2.4 0-7.5 0.8-7.5 1.8z" },
  { kind: "body", d: "m102.5 60.4c-4.3 1.8-8.8 4.6-10.4 8.5-0.7 2.3 1.4 4.3 1.9 12.6-0.1 3.1 2.9 4.9 2.7 6.1 0.2 1.6 0.9-0.7 6.5-4.2 3.7-2.5 8.3-4.7 12.5-4.9 4.4-0.1 5.5 2.5 7.4 6 2.4 4.7 6.9 14.2 8.1 16 0.7 0.9 9.4-1.4 12.3-3.9 2.4-1.7 3.7-3.2 3-9-1.8-12-10.5-24.1-19-28.1-5.1-2.6-11.3-2.8-17.9-1.8-2.1 0.4-5 1.3-7.1 2.7z" },
  { kind: "body", d: "m133.2 111.9c-1.5-2.3-3-5.7-4.6-8.7-3.2-6.5-8.2-20.2-11.2-21.3-3.4-1.3-9.5 1.1-14.9 5.5l-4.6 3.6c-1.5 0.7-3.7-3.9-5.4-5.4-0.9-0.9-3-2-4.4-0.1l-1.7 2c-2.8 2.5-1.2 2.7-2.4 7.7-1 3.8-7.1 13.8-7.3 16.2 0.2 2.2 3.3 2.1 5.4 0.5 3.5-2.4 5.4-10.3 6.4-17.5 0.9-6.2 1.2-4.2 3.6-2.8 2.4 1.8 7 3.3 9.1 2.8 2.9 0 7.7-3.5 11.7-8.2 2.6-2.8 2.6-3.6 3.6-1.6 5.2 10.8 10.5 15.8 14 24.9 3.6 8.4 5.9 12.4 13.6 14.7l3.3 1.2c4 1.2 5.1-1.3 0.7-2.2-3.9-1.3-9.6-4.2-14.9-11.3z" },
  { kind: "body", d: "m75.6 83.6c-1.2-0.2-2.7 0.3-3.4 2.8-1 6.7 0.5 19.5-1.7 26.2-2.6 7.1-5.6 8-9.9 11-3 2.3-0.7 2.9 0.5 2.9 1.3-0.1 6-2.4 8.5-3.9 3.8-2.2 4.3-6 4.8-9.2 1-6.8 1.2-13.9 1.2-19.2 2.8 3 7 3.3 6.3-1.1-0.9-2.7-3.9-8.6-6.3-9.5z" },
  { kind: "body", d: "m114.1 89c-1.5 2.9-6.2 5.6-8 5.9-1.9 1 2 2.5 3.5 3.1 3 1.4 3.3 1.5 4.1 3.4l2.4 6.2c1.8 4.5 3.5 8.1 9.4 9 2.6 0.6 3.6-1.2 2-1.7-2.4-0.9-4-2-5.9-4.9-2.4-3.4-4.5-6.6-3-8 1.4-1.4 4.5 1.5 3.5-1-2.4-3.8-4.6-7-6.7-12-0.5-0.9-1.2-1.1-1.3 0z" },
  { kind: "eye", d: "m30.5 63.6c-7.1 0.1-13.9 6.3-14.9 15.5 0 4.8 0.9 5.9 3.8 5.4 5.1-0.5 13.8-5.8 16.6-11.6 2.9-6.5 0.1-9.3-5.5-9.3z" },
  { kind: "shine", d: "m25.6 72.9c-1.1 2.5-3.6 4-5.2 3-1.7-0.9-1.9-3.4-0.5-5.5 1.3-2 3.7-3.2 5.2-2.2 1.4 0.8 1.5 2.8 0.5 4.7z" },
  { kind: "detail", d: "m122.5 105.7 1.2-0.3 2.9 5.3c-1-0.3-2.7-2.6-4.1-5z" }
];

const NS = "http://www.w3.org/2000/svg";

export class AntWalker {
  svg: SVGElement;
  options: Required<AntWalkerOptions>;
  ants: AntItem[] = [];
  start: number | null = null;
  rafId: number | null = null;
  pathLength: number = 0;
  filterSuffix: string = Math.random().toString(36).substring(2, 9);

  defs: SVGDefsElement | null = null;
  routeLine: SVGPathElement | null = null;
  routeGlow: SVGPathElement | null = null;
  antsLayer: SVGGElement | null = null;
  measurePath: SVGPathElement | null = null;

  /**
   * @param {SVGElement} svgElement - The target SVG container
   * @param {AntWalkerOptions} options - Configuration options
   */
  constructor(svgElement: SVGElement, options: AntWalkerOptions = {}) {
    if (!svgElement || svgElement.namespaceURI !== NS) {
      throw new Error("AntWalker requires a valid SVG element context.");
    }
    this.svg = svgElement;

    // Default configuration
    this.options = {
      pathD: "M80 455 C205 85 395 120 505 310 S755 555 920 135",
      endMode: "reset",
      antCount: 12,
      spacing: 7.5,
      duration: 9000,
      palette: ["#7cff2e", "#25d473", "#00d4ff"],
      bodyColor: "#0a253c",
      outlineColor: "#f3faf4",
      routeColor: "#7cff2e",
      antScale: 0.44,
      leaderEnabled: true,
      leaderColor: "#baff55",
      leaderScale: 1.32,
      showPath: false,
      spritesheetPath: "/ant-spritesheet.png",
      ...options
    } as Required<AntWalkerOptions>;

    this.init();
  }

  init() {
    this.setupDefs();
    this.setupPaths();
    this.rebuildAnts();
    this.startAnimation();
  }

  setupDefs() {
    if (this.defs) this.defs.remove();

    this.defs = document.createElementNS(NS, "defs") as SVGDefsElement;

    // 1. Soft Glow Filter
    const softGlow = document.createElementNS(NS, "filter") as SVGFilterElement;
    softGlow.setAttribute("id", `softGlow-${this.filterSuffix}`);
    softGlow.setAttribute("x", "-40%");
    softGlow.setAttribute("y", "-40%");
    softGlow.setAttribute("width", "180%");
    softGlow.setAttribute("height", "180%");
    const softBlur = document.createElementNS(NS, "feGaussianBlur");
    softBlur.setAttribute("stdDeviation", "5");
    softBlur.setAttribute("result", "blur");
    const softMerge = document.createElementNS(NS, "feMerge");
    const softMergeNode1 = document.createElementNS(NS, "feMergeNode");
    softMergeNode1.setAttribute("in", "blur");
    const softMergeNode2 = document.createElementNS(NS, "feMergeNode");
    softMergeNode2.setAttribute("in", "SourceGraphic");
    softMerge.appendChild(softMergeNode1);
    softMerge.appendChild(softMergeNode2);
    softGlow.appendChild(softBlur);
    softGlow.appendChild(softMerge);

    // 2. Eye Glow Filter
    const eyeGlow = document.createElementNS(NS, "filter") as SVGFilterElement;
    eyeGlow.setAttribute("id", `eyeGlow-${this.filterSuffix}`);
    eyeGlow.setAttribute("x", "-120%");
    eyeGlow.setAttribute("y", "-120%");
    eyeGlow.setAttribute("width", "340%");
    eyeGlow.setAttribute("height", "340%");
    const eyeBlur = document.createElementNS(NS, "feGaussianBlur");
    eyeBlur.setAttribute("stdDeviation", "3.4");
    eyeBlur.setAttribute("result", "blur");
    const eyeMerge = document.createElementNS(NS, "feMerge");
    const eyeMergeNode1 = document.createElementNS(NS, "feMergeNode");
    eyeMergeNode1.setAttribute("in", "blur");
    const eyeMergeNode2 = document.createElementNS(NS, "feMergeNode");
    eyeMergeNode2.setAttribute("in", "SourceGraphic");
    eyeMerge.appendChild(eyeMergeNode1);
    eyeMerge.appendChild(eyeMergeNode2);
    eyeGlow.appendChild(eyeBlur);
    eyeGlow.appendChild(eyeMerge);

    // 3. Leader Glow Filter
    const leaderGlow = document.createElementNS(NS, "filter") as SVGFilterElement;
    leaderGlow.setAttribute("id", `leaderGlow-${this.filterSuffix}`);
    leaderGlow.setAttribute("x", "-140%");
    leaderGlow.setAttribute("y", "-140%");
    leaderGlow.setAttribute("width", "380%");
    leaderGlow.setAttribute("height", "380%");
    const leaderBlur = document.createElementNS(NS, "feGaussianBlur");
    leaderBlur.setAttribute("stdDeviation", "4.4");
    leaderBlur.setAttribute("result", "blur");
    const leaderMerge = document.createElementNS(NS, "feMerge");
    const leaderMergeNode1 = document.createElementNS(NS, "feMergeNode");
    leaderMergeNode1.setAttribute("in", "blur");
    const leaderMergeNode2 = document.createElementNS(NS, "feMergeNode");
    leaderMergeNode2.setAttribute("in", "SourceGraphic");
    leaderMerge.appendChild(leaderMergeNode1);
    leaderMerge.appendChild(leaderMergeNode2);
    leaderGlow.appendChild(leaderBlur);
    leaderGlow.appendChild(leaderMerge);

    // 4. Ant Shadow Filter
    const antShadow = document.createElementNS(NS, "filter") as SVGFilterElement;
    antShadow.setAttribute("id", `antShadow-${this.filterSuffix}`);
    antShadow.setAttribute("x", "-70%");
    antShadow.setAttribute("y", "-70%");
    antShadow.setAttribute("width", "240%");
    antShadow.setAttribute("height", "240%");
    const dropShadow = document.createElementNS(NS, "feDropShadow");
    dropShadow.setAttribute("dx", "0");
    dropShadow.setAttribute("dy", "7");
    dropShadow.setAttribute("stdDeviation", "5");
    dropShadow.setAttribute("flood-color", "#000000");
    dropShadow.setAttribute("flood-opacity", "0.42");
    antShadow.appendChild(dropShadow);

    // 5. Ant Crop ClipPath (150x150px centered frame)
    const antClip = document.createElementNS(NS, "clipPath") as SVGClipPathElement;
    antClip.setAttribute("id", `antClip-${this.filterSuffix}`);
    const clipRect = document.createElementNS(NS, "rect");
    clipRect.setAttribute("x", "-75");
    clipRect.setAttribute("y", "-75");
    clipRect.setAttribute("width", "150");
    clipRect.setAttribute("height", "150");
    antClip.appendChild(clipRect);

    this.defs.appendChild(softGlow);
    this.defs.appendChild(eyeGlow);
    this.defs.appendChild(leaderGlow);
    this.defs.appendChild(antShadow);
    this.defs.appendChild(antClip);
    this.svg.appendChild(this.defs);
  }

  setupPaths() {
    if (this.routeGlow) this.routeGlow.remove();
    if (this.routeLine) this.routeLine.remove();
    if (this.measurePath) this.measurePath.remove();

    this.routeGlow = document.createElementNS(NS, "path") as SVGPathElement;
    this.routeGlow.setAttribute("fill", "none");
    this.routeGlow.setAttribute("stroke-linecap", "round");
    this.routeGlow.setAttribute("filter", `url(#softGlow-${this.filterSuffix})`);

    this.routeLine = document.createElementNS(NS, "path") as SVGPathElement;
    this.routeLine.setAttribute("fill", "none");
    this.routeLine.setAttribute("stroke-linecap", "round");
    this.routeLine.setAttribute("stroke-width", "6");
    this.routeLine.setAttribute("stroke-dasharray", "2 18");

    this.measurePath = document.createElementNS(NS, "path") as SVGPathElement;
    this.measurePath.setAttribute("fill", "none");
    this.measurePath.setAttribute("stroke", "none");
    this.measurePath.setAttribute("pointer-events", "none");

    this.updatePaths();

    this.svg.appendChild(this.routeGlow);
    this.svg.appendChild(this.routeLine);
    this.svg.appendChild(this.measurePath);
  }

  updatePaths() {
    if (!this.routeGlow || !this.routeLine || !this.measurePath) return;
    this.routeGlow.setAttribute("d", this.options.pathD);
    this.routeGlow.setAttribute("stroke", this.options.routeColor);
    this.routeGlow.setAttribute("stroke-width", "2.4");
    this.routeGlow.style.opacity = "0.95";

    this.routeLine.setAttribute("d", this.options.pathD);
    this.routeLine.setAttribute("stroke", "rgba(255,255,255,0.18)");

    this.measurePath.setAttribute("d", this.options.pathD);
    this.pathLength = this.measurePath.getTotalLength();

    if (!this.options.showPath) {
      this.routeGlow.style.display = "none";
      this.routeLine.style.display = "none";
    } else {
      this.routeGlow.style.display = "";
      this.routeLine.style.display = "";
    }
  }

  rebuildAnts() {
    if (this.antsLayer) this.antsLayer.remove();
    this.antsLayer = document.createElementNS(NS, "g") as SVGGElement;
    this.svg.appendChild(this.antsLayer);

    this.ants = [];
    const count = this.options.antCount;
    const palette = this.options.palette;

    for (let i = 0; i < count; i++) {
      const isLeader = this.options.leaderEnabled && i === 0;
      const eyeColor = isLeader ? this.options.leaderColor : palette[i % palette.length];
      const scale = this.options.antScale * (isLeader ? this.options.leaderScale : 1);

      const antNode = this.createAntNode(
        this.options.bodyColor,
        eyeColor,
        this.options.outlineColor,
        isLeader
      );

      this.antsLayer.appendChild(antNode);
      this.ants.push({
        node: antNode,
        index: i,
        scale: scale
      });
    }
  }

  // Copied-from: ../a-nice-terminal/src/lib/ant-motion/ant-motion.ts
  // Verdict: CHANGE
  // Simplification: Replaced static SVG paths with a dynamic image element cycling through spritesheet frames to implement crawling, and removed the late-90s decorative ring, crown, and arrow.
  createAntNode(bodyColor: string, eyeColor: string, outlineColor: string, isLeader: boolean): SVGElement {
    const wrapper = document.createElementNS(NS, "g") as SVGElement;
    wrapper.setAttribute("opacity", "0");

    const shadowG = document.createElementNS(NS, "g") as SVGElement;
    shadowG.setAttribute("filter", `url(#antShadow-${this.filterSuffix})`);

    // Create a group that has the clip-path applied to crop the image
    const spriteClipG = document.createElementNS(NS, "g") as SVGElement;
    spriteClipG.setAttribute("clip-path", `url(#antClip-${this.filterSuffix})`);

    // Inside it, create a group that flips the ant horizontally so it faces right and centers it
    const flipG = document.createElementNS(NS, "g") as SVGElement;
    flipG.setAttribute("transform", "scale(-1, 1) translate(-75, -75)");

    // Create the image referencing the spritesheet
    const img = document.createElementNS(NS, "image") as SVGElement;
    img.setAttributeNS("http://www.w3.org/1999/xlink", "href", this.options.spritesheetPath);
    img.setAttribute("href", this.options.spritesheetPath);
    img.setAttribute("x", "0");
    img.setAttribute("y", "0");
    img.setAttribute("width", "1200");
    img.setAttribute("height", "150");
    img.setAttribute("class", "ant-spritesheet-image");

    flipG.appendChild(img);
    spriteClipG.appendChild(flipG);
    shadowG.appendChild(spriteClipG);
    wrapper.appendChild(shadowG);

    return wrapper;
  }

  tangentAt(distance: number) {
    if (!this.measurePath || this.pathLength === 0) {
      return { point: { x: 0, y: 0 }, angle: 0, nx: 0, ny: 0 };
    }
    const before = this.measurePath.getPointAtLength(Math.max(0, Math.min(this.pathLength, distance - 2)));
    const point = this.measurePath.getPointAtLength(Math.max(0, Math.min(this.pathLength, distance)));
    const after = this.measurePath.getPointAtLength(Math.max(0, Math.min(this.pathLength, distance + 2)));
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const len = Math.max(0.0001, Math.hypot(dx, dy));
    return {
      point,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      nx: -dy / len,
      ny: dx / len
    };
  }

  placeAnt(ant: AntItem, t: number, opacity: number, backwards = false) {
    const distance = Math.max(0, Math.min(1, t)) * this.pathLength;
    const { point, angle, nx, ny } = this.tangentAt(distance);
    const step = Math.sin((t * this.pathLength) / 18 + ant.index * 1.9) * 1.8;

    const tx = (point.x + nx * step).toFixed(2);
    const ty = (point.y + ny * step).toFixed(2);

    // Upright, no rotation: determine horizontal flip based on travel direction
    const travelAngle = angle + (backwards ? 180 : 0);
    const rad = (travelAngle * Math.PI) / 180;
    const isMovingLeft = Math.cos(rad) < 0;

    const sx = isMovingLeft ? -ant.scale : ant.scale;
    const sy = ant.scale;

    // Position the ant without any rotation to keep it upright
    ant.node.setAttribute("transform", `translate(${tx} ${ty}) scale(${sx.toFixed(3)} ${sy.toFixed(3)})`);
    ant.node.setAttribute("opacity", Math.max(0, Math.min(1, opacity)).toFixed(3));

    // Update the spritesheet image position to simulate crawling
    const img = ant.node.querySelector(".ant-spritesheet-image");
    if (img) {
      const stepLength = 60; // distance in pixels for a full 8-frame walk cycle
      const cycle = (t * this.pathLength) / stepLength;
      const frameIndex = ((Math.floor(cycle * 8) % 8) + 8) % 8;
      const offset = -frameIndex * 150;
      img.setAttribute("x", offset.toString());
    }
  }

  startAnimation() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    
    // Check user accessibility preference for reduced motion
    const prefersReducedMotion = 
      typeof window !== 'undefined' && 
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      // Draw static ants once along the path, do not launch RAF loop
      this.ants.forEach((ant) => {
        this.placeAnt(ant, 0.5 - ant.index * 0.05, 1);
      });
      return;
    }

    this.start = null;
    const run = (now: number) => {
      if (!this.start) this.start = now;
      const elapsed = now - this.start;
      this.tick(elapsed);
      this.rafId = requestAnimationFrame(run);
    };
    this.rafId = requestAnimationFrame(run);
  }

  tick(elapsed: number) {

    const spacingVal = this.options.spacing / 100;
    const maxDelay = spacingVal * Math.max(0, this.ants.length - 1);

    if (this.options.endMode === "stay") {
      const base = Math.min(elapsed / this.options.duration, 1 + maxDelay);
      this.ants.forEach((ant) => {
        const t = base - ant.index * spacingVal;
        this.placeAnt(ant, Math.max(0, Math.min(1, t)), t < 0 ? 0 : 1);
      });
    } else if (this.options.endMode === "fade") {
      const total = this.options.duration * (1 + maxDelay + 0.35);
      const base = (elapsed % total) / this.options.duration;
      this.ants.forEach((ant) => {
        const raw = base - ant.index * spacingVal;
        if (raw < 0) this.placeAnt(ant, 0, 0);
        else if (raw <= 1) {
          const fade = raw > 0.82 ? 1 - (raw - 0.82) / 0.18 : 1;
          this.placeAnt(ant, raw, fade);
        } else this.placeAnt(ant, 1, 0);
      });
    } else if (this.options.endMode === "reverse") {
      const cycle = (elapsed % (this.options.duration * 2)) / this.options.duration;
      const backwards = cycle > 1;
      const base = backwards ? 2 - cycle : cycle;
      this.ants.forEach((ant) => {
        const t = backwards ? base + ant.index * spacingVal : base - ant.index * spacingVal;
        this.placeAnt(ant, Math.max(0, Math.min(1, t)), t < 0 || t > 1 ? 0 : 1, backwards);
      });
    } else {
      const base = (elapsed % this.options.duration) / this.options.duration;
      this.ants.forEach((ant) => {
        const t = (((base - ant.index * spacingVal) % 1) + 1) % 1;
        this.placeAnt(ant, t, 1);
      });
    }
  }

  updateOptions(newOptions: AntWalkerOptions) {
    const pathChanged =
      (newOptions.pathD !== undefined && newOptions.pathD !== this.options.pathD) ||
      (newOptions.showPath !== undefined && newOptions.showPath !== this.options.showPath);
    const rebuildNeeded =
      pathChanged ||
      (newOptions.spritesheetPath !== undefined && newOptions.spritesheetPath !== this.options.spritesheetPath) ||
      (newOptions.antCount !== undefined && newOptions.antCount !== this.options.antCount) ||
      (newOptions.leaderEnabled !== undefined && newOptions.leaderEnabled !== this.options.leaderEnabled) ||
      (newOptions.leaderColor !== undefined && newOptions.leaderColor !== this.options.leaderColor) ||
      (newOptions.bodyColor !== undefined && newOptions.bodyColor !== this.options.bodyColor) ||
      (newOptions.outlineColor !== undefined && newOptions.outlineColor !== this.options.outlineColor) ||
      (newOptions.antScale !== undefined && newOptions.antScale !== this.options.antScale) ||
      (newOptions.leaderScale !== undefined && newOptions.leaderScale !== this.options.leaderScale) ||
      (newOptions.palette !== undefined && JSON.stringify(newOptions.palette) !== JSON.stringify(this.options.palette));

    Object.assign(this.options, newOptions);

    if (pathChanged) {
      this.updatePaths();
    }
    if (rebuildNeeded) {
      this.rebuildAnts();
    }
    this.start = null;
  }

  destroy() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
    if (this.defs) this.defs.remove();
    if (this.routeGlow) this.routeGlow.remove();
    if (this.routeLine) this.routeLine.remove();
    if (this.measurePath) this.measurePath.remove();
    if (this.antsLayer) this.antsLayer.remove();
  }
}
