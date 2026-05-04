export interface ViewportMetricInput {
  innerHeight: number;
  innerWidth: number;
  viewportHeight?: number;
  viewportWidth?: number;
  offsetTop?: number;
  offsetLeft?: number;
}

export interface ViewportMetrics {
  viewportHeight: number;
  viewportWidth: number;
  viewportOffsetTop: number;
  viewportOffsetLeft: number;
  keyboardHeight: number;
}

export function computeViewportMetrics(input: ViewportMetricInput): ViewportMetrics {
  const innerHeight = Math.max(0, input.innerHeight || 0);
  const innerWidth = Math.max(0, input.innerWidth || 0);
  const viewportHeight = Math.max(0, input.viewportHeight ?? innerHeight);
  const viewportWidth = Math.max(0, input.viewportWidth ?? innerWidth);
  const viewportOffsetTop = Math.max(0, input.offsetTop ?? 0);
  const viewportOffsetLeft = Math.max(0, input.offsetLeft ?? 0);

  return {
    viewportHeight,
    viewportWidth,
    viewportOffsetTop,
    viewportOffsetLeft,
    keyboardHeight: Math.max(0, innerHeight - viewportHeight - viewportOffsetTop),
  };
}

export function installAntViewportVars(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  const root = document.documentElement;
  const visualViewport = window.visualViewport;
  let frame = 0;

  function readMetrics() {
    return computeViewportMetrics({
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      viewportHeight: visualViewport?.height,
      viewportWidth: visualViewport?.width,
      offsetTop: visualViewport?.offsetTop,
      offsetLeft: visualViewport?.offsetLeft,
    });
  }

  function writeVars() {
    frame = 0;
    const metrics = readMetrics();
    root.style.setProperty('--ant-viewport-h', `${Math.round(metrics.viewportHeight)}px`);
    root.style.setProperty('--ant-viewport-w', `${Math.round(metrics.viewportWidth)}px`);
    root.style.setProperty('--ant-viewport-offset-top', `${Math.round(metrics.viewportOffsetTop)}px`);
    root.style.setProperty('--ant-viewport-offset-left', `${Math.round(metrics.viewportOffsetLeft)}px`);
    root.style.setProperty('--ant-keyboard-h', `${Math.round(metrics.keyboardHeight)}px`);
  }

  function scheduleWrite() {
    if (frame) return;
    frame = window.requestAnimationFrame(writeVars);
  }

  writeVars();
  window.addEventListener('resize', scheduleWrite);
  window.addEventListener('orientationchange', scheduleWrite);
  visualViewport?.addEventListener('resize', scheduleWrite);
  visualViewport?.addEventListener('scroll', scheduleWrite);

  return () => {
    if (frame) window.cancelAnimationFrame(frame);
    window.removeEventListener('resize', scheduleWrite);
    window.removeEventListener('orientationchange', scheduleWrite);
    visualViewport?.removeEventListener('resize', scheduleWrite);
    visualViewport?.removeEventListener('scroll', scheduleWrite);
  };
}
