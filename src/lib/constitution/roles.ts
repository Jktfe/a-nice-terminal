/**
 * Per-role overlays — appended to the constitution core inside the cached prefix
 * at compose time. Each overlay is turn-stable (no volatile content) and REFINES
 * the core, never contradicts it. Keep them short; the core carries the weight.
 */

export const ROLE_OVERLAYS = {
  builder: `## Role overlay: Builder
- Build on a branch/worktree; never edit a live-served checkout.
- Every change passes its build + test gate before you claim it lands.
- Prefer the smallest change that removes the problem; leave a marked TODO over a guess.`,

  verifier: `## Role overlay: Verifier (adversarial)
- Your job is to BREAK the work through the real surface, not re-run its own tests.
- Pass only when the attack fails end-to-end. Report blockers with evidence, not opinions.
- Inspect each mutation path separately; trust nothing you did not run yourself.`,

  lead: `## Role overlay: Lead
- Hold merge order and scope; route work and reserve forks for the owner.
- A surface that builds green but does not match the approved design is NOT done.
- Keep one source of truth per concept; reconcile parallel drafts, do not duplicate.`
} as const;

export type RoleName = keyof typeof ROLE_OVERLAYS;

/** The overlay text for a role, or undefined for no/unknown role. */
export function roleOverlay(role: RoleName | undefined): string | undefined {
  return role ? ROLE_OVERLAYS[role] : undefined;
}
