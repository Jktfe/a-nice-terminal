/**
 * POST /api/decks/:deckId/stage-feedback
 *
 * delta: feedback submission with pause-context attached.
 * The deck viewer POSTs here when the user hits Submit in the feedback panel.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { randomUUID } from 'node:crypto';
import { getDeck } from '$lib/server/deckStore';
import { requireStagePresenterAuth } from '$lib/server/stagePresenterAuth';
import { appendPlanEvent } from '$lib/server/planModeStore';
import { postMessage } from '$lib/server/chatMessageStore';
import { broadcastToRoom } from '$lib/server/eventBroadcast';
import { fanoutMessageToRoomTerminals } from '$lib/server/pty-inject-fanout';
import { createArtefactInRoom } from '$lib/server/chatRoomArtefactStore';
import { upsertArtefactContent } from '$lib/server/chatRoomArtefactContentStore';
import { createTask } from '$lib/server/taskStore';
import { processStageAlternatives } from '$lib/server/stageAlternativeProcessor';

type StageFeedbackPayload = {
  slideIndex?: unknown;
  feedbackText?: unknown;
  pasteContext?: unknown;
  pauseContextRef?: unknown;
  targetClaimId?: unknown;
  validationLensId?: unknown;
};

const ALTERNATIVE_SHAPES = [
  {
    id: 'replace',
    title: 'Replace slide',
    prompt: 'Draft a direct replacement for the current slide that answers this feedback.'
  },
  {
    id: 'explain',
    title: 'Add explanatory slide',
    prompt: 'Draft a new slide immediately after this one that explains the missing logic.'
  },
  {
    id: 'appendix',
    title: 'Append appendix evidence',
    prompt: 'Draft an appendix slide with supporting evidence, caveats, or implementation detail.'
  }
] as const;

function cleanText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function buildAlternativeTrackMarkdown(input: {
  deckTitle: string;
  slideNumber: number;
  slideTitle: string;
  feedbackText: string;
  pasteContext: string;
  pauseContextRef: string;
  targetClaimId: string;
  validationLensId: string;
  narratorContext: string;
  createdBy: string;
}): string {
  const context = cleanText(input.narratorContext, 1200);
  const pasted = cleanText(input.pasteContext, 1200);
  return [
    `# Alternative Track: ${input.deckTitle} / slide ${input.slideNumber}`,
    '',
    `Source slide: **${input.slideTitle}**`,
    `Created by: ${input.createdBy}`,
    '',
    '## Feedback Anchor',
    '',
    input.pauseContextRef ? `Pause context: \`${input.pauseContextRef}\`` : 'Pause context: not supplied',
    input.targetClaimId ? `Target claim: \`${input.targetClaimId}\`` : 'Target claim: not supplied yet',
    input.validationLensId ? `Validation lens: \`${input.validationLensId}\`` : 'Validation lens: default / not supplied',
    '',
    '## User Feedback',
    '',
    input.feedbackText,
    '',
    '## Pasted Context',
    '',
    pasted || '_No additional context pasted._',
    '',
    '## Last Spoken / Speaker Context',
    '',
    context || '_No narration context supplied._',
    '',
    '## Agent Work Required',
    '',
    '- Identify which claim or sentence the feedback challenges.',
    '- Draft a Version B for this slide or path.',
    '- List downstream slides or claims that may become stale.',
    '- State whether the change should replace the slide, add a new slide, or go to appendix.',
    '- Leave the source deck unchanged until the presenter adopts the proposal.',
    '',
    '## Alternative Shapes',
    '',
    ...ALTERNATIVE_SHAPES.flatMap((shape) => [
      `### ${shape.title}`,
      '',
      shape.prompt,
      ''
    ]),
    '',
    '## Proposal Status',
    '',
    'Seeded automatically from live Stage feedback. Awaiting agent expansion.',
    ''
  ].join('\n');
}

export const POST: RequestHandler = async ({ params, request, url }) => {
  const deck = getDeck(params.deckId);
  if (!deck) throw error(404, 'Deck not found.');

  const payload = (await request.json().catch(() => null)) as StageFeedbackPayload | null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw error(400, 'JSON body required.');
  }

  const auth = requireStagePresenterAuth({
    roomId: deck.roomId,
    deckAccessPassword: deck.accessPassword,
    request,
    url,
    rawBody: payload
  });

  const slideIndex =
    typeof payload.slideIndex === 'number' && Number.isInteger(payload.slideIndex)
      ? payload.slideIndex
      : 0;
  const slide = deck.slides[slideIndex];
  if (!slide) throw error(400, 'slideIndex is outside the deck.');

  const feedbackText = typeof payload.feedbackText === 'string' ? payload.feedbackText : '';
  const pasteContext = typeof payload.pasteContext === 'string' ? payload.pasteContext : '';
  const pauseContextRef = typeof payload.pauseContextRef === 'string' ? payload.pauseContextRef : '';
  const targetClaimId = typeof payload.targetClaimId === 'string' ? payload.targetClaimId : '';
  const validationLensId = typeof payload.validationLensId === 'string' ? payload.validationLensId : '';

  if (feedbackText.trim().length === 0) {
    throw error(400, 'feedbackText is required.');
  }

  const tsMillis = Date.now();
  const ref = pauseContextRef || `stage:${deck.id}:slide:${slide.id ?? slideIndex}:feedback`;
  const label = `Feedback on slide ${slideIndex + 1}: ${slide.title}`;
  const alternativeTitle = `Alternative Track: ${deck.title} / slide ${slideIndex + 1}`;
  const alternativeArtefactId = randomUUID();
  const alternativeDocUrl = `/api/chat-rooms/${encodeURIComponent(deck.roomId)}/docs/${encodeURIComponent(alternativeArtefactId)}`;
  const alternativeArtefact = createArtefactInRoom({
    id: alternativeArtefactId,
    roomId: deck.roomId,
    kind: 'doc',
    title: alternativeTitle,
    refUrl: alternativeDocUrl,
    summary: cleanText(feedbackText, 220),
    createdBy: auth.handle,
    nowMs: tsMillis
  });
  const alternativeMarkdown = buildAlternativeTrackMarkdown({
    deckTitle: deck.title,
    slideNumber: slideIndex + 1,
    slideTitle: slide.title,
    feedbackText: cleanText(feedbackText, 2000),
    pasteContext,
    pauseContextRef: ref,
    targetClaimId,
    validationLensId,
    narratorContext: pasteContext || (slide.speakerNotes ?? slide.narration ?? slide.content),
    createdBy: auth.handle
  });
  upsertArtefactContent({
    id: alternativeArtefact.id,
    artefactId: alternativeArtefact.id,
    roomId: deck.roomId,
    kind: 'doc',
    contentFormat: 'markdown',
    contentBody: alternativeMarkdown,
    updatedByHandle: auth.handle,
    nowMs: tsMillis
  });
  const proposalRef = `/artefacts/${alternativeArtefact.id}`;
  const proposalTasks = ALTERNATIVE_SHAPES.map((shape, index) =>
    createTask({
      id: `task-stage-alternative-${shape.id}-${tsMillis}-${Math.random().toString(36).slice(2, 8)}`,
      subject: `${alternativeTitle} (${shape.title})`,
      description: shape.prompt,
      status: 'pending',
      priority: index + 1,
      planId: `stage-${deck.id}`,
      assignedAgent: null,
      evidence: [
        {
          kind: 'proposal',
          ref: `${proposalRef}#shape-${shape.id}`,
          label: `${shape.title}: ${alternativeTitle}`,
          narration: alternativeMarkdown
        }
      ],
      notes: `Seeded from ${ref}; shape=${shape.id}`,
      startedAtMs: tsMillis
    })
  );

  appendPlanEvent({
    id: `evt-stage-feedback-${tsMillis}-${Math.random().toString(36).slice(2, 10)}`,
    plan_id: `stage-${deck.id}`,
    kind: 'plan_decision',
    title: `Stage feedback: ${deck.title} - ${label}`,
    body: feedbackText,
    order: slideIndex,
    author_handle: auth.handle,
    author_kind: auth.isAdminBearer ? 'system' : (auth.isDeckPassword ? 'human' : 'agent'),
    ts_millis: tsMillis,
    evidence: [
      {
        kind: 'stage_feedback',
        ref,
        label,
        narration: pasteContext || (slide.speakerNotes ?? slide.narration ?? slide.content),
        deck_id: deck.id,
        slide_id: slide.id,
        slide_index: slideIndex
      }
    ],
    provenance: { source: 'deck-viewer', section: deck.id, author: auth.handle }
  });
  const generatedAlternatives = processStageAlternatives(deck.id, auth.handle);

  // The "magic" is that Stage feedback reaches the agents' terminals directly so
  // they can draft new slides on the fly — no "did you see my comments?" round-trip.
  // It MUST post as a human-kind message authored by the presenter: the fanout's
  // FANOUT_KINDS_ALLOWED gate ({human, agent}) silently drops 'system' messages,
  // so postSystemMessage() landed this in room history but never injected it into
  // any terminal. postMessage({kind:'human'}) is on the delivered side of that gate.
  const roomMessage = postMessage({
    roomId: deck.roomId,
    authorHandle: auth.handle,
    kind: 'human',
    body:
      `Stage feedback on "${deck.title}" — slide ${slideIndex + 1} (${slide.title})\n\n` +
      `${feedbackText}\n\n` +
      `Seeded an Alternative Track (${proposalRef}) with ${proposalTasks.length} draft tasks. ` +
      `You have autonomy to draft the replacement/new slide directly from this — no need to wait for a go-ahead.`
  });
  try {
    // forceBroadcastToAll: Stage feedback is inherently room-wide — ANY agent in
    // the room should be able to pick it up and draft a slide, not just an
    // @-mentioned one or the operator's own broadcast. Without this, a non-operator
    // presenter's feedback with no explicit @ would reach nobody (delivery loop
    // skips untargeted members). Focus/shield/solo + room-mode gates still apply.
    fanoutMessageToRoomTerminals(deck.roomId, roomMessage, { forceBroadcastToAll: true });
  } catch { /* best-effort */ }
  try {
    broadcastToRoom(deck.roomId, { type: 'message_added', message: roomMessage });
  } catch { /* best-effort */ }

  return json({
    ok: true,
    ref,
    slideIndex,
    proposal: {
      taskIds: proposalTasks.map((task) => task.id),
      artefactId: alternativeArtefact.id,
      ref: proposalRef
    },
    generatedAlternatives
  }, { status: 201 });
};
