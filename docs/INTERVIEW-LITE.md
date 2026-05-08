# Interview-Lite

A focused dialog overlay that lets a user interview an agent (and
optionally pull in same-room agents for context) without spinning up a
full chatroom. Built per `interview-lite-2026-05-08`.

## Launch

Hover any agent-authored chat message and click **Interview** beside
**Reply**. The modal opens rooted at that message; the message author
becomes the `target` participant.

The button is gated to messages that have a `sender_id` (or are AI-role)
— user-authored messages can't be interviewed because there's no agent
target to converse with.

## Participant model

- **Target** — the source-message agent. Required, can't be removed.
- **Participants** — same-room agents added via the **+ add agent**
  picker. Active repliers by default; mute is TTS-only.

Mute toggle (speaker icon next to each participant header):

- **Speaking** (default) — agent's text reply is read aloud via TTS.
- **Muted** — agent still receives prompts and replies in text; TTS
  is suppressed for that agent only.

## Voice mode

Default-on TTS reads each agent reply aloud. Provider precedence:

1. **ElevenLabs** when `ELEVENLABS_API_KEY` is set in the server env.
   Audio bytes streamed via `/api/voice/elevenlabs` (the proxy keeps
   the key server-side). Each utterance generates a blob URL that's
   cached per message id for replay.
2. **Browser SpeechSynthesis** (`window.speechSynthesis`) — robotic
   but free, no server roundtrip. Replay re-synthesises since
   browser TTS doesn't expose a cacheable stream.

Provider choice is global (server config, not per-user). Replay
control sits next to each agent message; click to play the cached
or re-synthesised audio at any point during or after the interview.

## Transcript

When the user clicks **End interview**, the page:

1. Builds a markdown transcript via `buildInterviewTranscript()`
   (`src/lib/voice/interview-transcript.ts`) — Source / Participants
   / Timeline / Transcript sections plus meta payload.
2. POSTs `/api/docs` to create a research doc with id
   `interview-<interviewId>` and the date-stamped title
   `Interview · <target> · YYYY-MM-DD`.
3. PATCHes `/api/docs/<docId>` with the transcript markdown as a
   single section.
4. POSTs `/api/interviews/<id>/end` with `transcript_ref` +
   `transcript_path` so m5 summary post-back can reference the
   transcript when the target agent posts the summary back to the
   origin room.

The Obsidian mirror at `$ANT_OBSIDIAN_VAULT/research/interview-<id>.md`
is written automatically by the docs API — no extra wiring.

## Summary post-back (m5)

When an interview ends, the target agent generates a summary and posts
it back to the origin room with `reply_to=parent_message_id` and
`meta.interview_id` + `meta.transcript_ref` for traceability. The
summary message appears as a normal reply in the chat thread that
launched the interview.

## Retention

Interviews and their messages live in the `interviews` and
`interview_messages` tables — append-only via the m0 endpoints. There
is **no automatic cleanup** at present; interviews stay queryable
indefinitely via `GET /api/interviews/<id>`. Transcripts mirror to
the Obsidian vault on `End interview` and persist there for the
lifetime of the vault. To prune, delete the vault file plus the
underlying `interviews` row + corresponding `interview_messages`.

If we add automated retention later, m6 hardening is the right place
— with a cap of e.g. 30 days for the database side and a "this
transcript will be archived on date X" badge in the modal header.

## Provider failure modes

- **ElevenLabs 503 / network failure** — TTSHandle resolves
  `audioUrl()` to null and the page silently falls through. Text
  reply is unaffected; the user sees the agent's words but doesn't
  hear them.
- **Browser TTS unavailable** (older browsers, headless) — the
  provider returns a no-op handle. Same fall-through.
- **Auto-resolve** picks ElevenLabs when `/api/voice/elevenlabs` GET
  reports `available: true`, otherwise falls back to browser TTS.

## Accessibility

- Dialog `role="dialog"` with `aria-modal="true"` and `aria-label`
  describing the target agent.
- Composer auto-focuses on open; Esc closes; **Tab** focus-traps
  inside the modal so keyboard users don't fall through to the
  underlying chat (whose action chips are hover-only).
- Original trigger element receives focus back when the modal closes.
- Transcript area has `role="log"` + `aria-live="polite"` so screen
  readers announce new agent messages even when their TTS is muted.

## Endpoints

| Method | Path                                   | Purpose                                                |
|--------|----------------------------------------|--------------------------------------------------------|
| POST   | `/api/interviews/start`                | Create an interview rooted at a message                |
| GET    | `/api/interviews/:id`                  | Bundle: interview + participants + messages            |
| POST   | `/api/interviews/:id/messages`         | Append a turn (user from the modal, agent from CLI)    |
| POST   | `/api/interviews/:id/participants`     | Add a same-room agent                                  |
| PATCH  | `/api/interviews/:id/participants/:sid`| Mute/unmute an agent                                   |
| DELETE | `/api/interviews/:id/participants/:sid`| Remove an added agent                                  |
| POST   | `/api/interviews/:id/end`              | Mark ended; record transcript_ref + summary_message_id |
| GET    | `/api/voice/elevenlabs`                | Availability probe                                     |
| POST   | `/api/voice/elevenlabs`                | TTS proxy (audio bytes back)                           |

## Files

- `src/lib/components/InterviewModal.svelte` — dialog UI
- `src/lib/components/MessageBubble.svelte` — Interview chip
- `src/lib/voice/interview-tts.ts` — provider abstraction
- `src/lib/voice/interview-transcript.ts` — markdown builder
- `src/lib/server/interviews.ts` — server query helpers
- `src/lib/server/interview-routing.ts` — m2 fan-out helper
- `src/lib/shared/interview-contract.ts` — shared types
- `src/routes/api/interviews/*` — REST endpoints
- `src/routes/api/voice/elevenlabs/+server.ts` — TTS proxy
- `tests/interview-{contract,tts,transcript}.test.ts` — unit suites
