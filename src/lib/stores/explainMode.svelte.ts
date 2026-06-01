/**
 * Explain mode store — global toggle for click-to-explain v0.
 * When active, interactive elements show dotted outlines and
 * clicking them reveals a what/why/link popover.
 */

let explainModeActive = $state(false);

export function getExplainMode(): boolean {
  return explainModeActive;
}

export function toggleExplainMode(): void {
  explainModeActive = !explainModeActive;
}

export function setExplainMode(active: boolean): void {
  explainModeActive = active;
}
