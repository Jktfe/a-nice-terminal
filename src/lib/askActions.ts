/**
 * askActions — shared transport for answering and dismissing asks (M22 slice 2).
 *
 * Pure transport + error-parsing. NO invalidateAll, NO component state,
 * NO in-flight tracking, NO error display. Callers own those concerns
 * (per @evolveantcodex slice 2 boundary). Two consumers:
 *   - /asks page (slice 3 baseline, refactored to use these helpers).
 *   - InteractiveAsksPanel (in-room widget, slice 2 baseline).
 *
 * Each helper POSTs to the accepted /api/asks/[askId]/{answer,dismiss}
 * endpoints (asks slice 2 backend) and surfaces non-OK responses as a
 * thrown Error with the server's parsed message (or statusText fallback).
 * Membership-before-validation lives in the endpoint; non-members receive
 * the standard error which callers render inline.
 */

export async function submitAnswerFor(input: {
  askId: string;
  actorHandle: string;
  answer: string;
}): Promise<void> {
  const response = await fetch(`/api/asks/${input.askId}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      answeredByHandle: input.actorHandle,
      answer: input.answer
    })
  });
  if (!response.ok) {
    const failurePayload = await response
      .json()
      .catch(() => ({ message: response.statusText }));
    throw new Error(
      typeof failurePayload?.message === 'string'
        ? failurePayload.message
        : response.statusText
    );
  }
}

export async function submitDismissFor(input: {
  askId: string;
  actorHandle: string;
}): Promise<void> {
  const response = await fetch(`/api/asks/${input.askId}/dismiss`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dismissedByHandle: input.actorHandle })
  });
  if (!response.ok) {
    const failurePayload = await response
      .json()
      .catch(() => ({ message: response.statusText }));
    throw new Error(
      typeof failurePayload?.message === 'string'
        ? failurePayload.message
        : response.statusText
    );
  }
}
