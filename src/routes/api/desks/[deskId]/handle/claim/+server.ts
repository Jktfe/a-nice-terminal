/**
 * Claim is an alias of move in the deployed Desk contract. The operation is
 * atomic: claim the handle for this Desk, clear any prior Desk claim, and
 * witness-bind the current pane when it exists.
 */

export { POST } from '../move/+server';
