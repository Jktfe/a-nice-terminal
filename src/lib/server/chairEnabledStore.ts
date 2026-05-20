/**
 * Chair-enabled store — per-instance opt-out toggle for the Chair function.
 *
 * Backs Chair-rename slice 2b (D1 optionality). Module-level boolean ref,
 * default-true so Chair renders normally on first boot. Disabling is an
 * explicit operator action via PUT /api/chair-enabled.
 *
 * Mirrors the module-level state pattern already used by composerDraftStore
 * and focusModeStore.
 */

let chairEnabledState = true;

export function isChairEnabled(): boolean {
  return chairEnabledState;
}

export function setChairEnabled(value: boolean): void {
  chairEnabledState = value;
}

export function resetChairEnabledStoreForTests(): void {
  chairEnabledState = true;
}
