# Interview Mode — Implementation Sketch

Date: 2026-05-05
Status: Pre-deck technical sketch. Not a build commitment.

## What James Asked For

> Click an agent and have an interview with an agent — talk back and forth. The agent captures the conversation as a side discussion and posts the summary and findings back into the origin chat. If I interrupt, the agent pauses, integrates the interruption, and adjusts its response.

## Build Order

Smallest reversible slice first. Each slice ships independently.

### Slice 1 — Voice composer affordance (1-2 days)

- Add a microphone icon to the chat composer.
- On click: capture system text from Wispr Flow (already user's default speech-to-text). No in-browser STT — defer to the OS-level tool the user already trusts.
- Add a setting: "auto-send on N-second silence" (VAD-style). Default off. When on, the composer dispatches the message after detected pause from the dictation source.
- Surface: composer toolbar component. Existing send pipeline unchanged.

Risk: Wispr Flow integration is per-OS. Start with macOS only; document the API used.

### Slice 2 — Linked-chat as interview surface (0 days, already exists)

- Linked chats already pair one human + one agent. No new entity needed.
- Add a quick-action: "Start interview with @agent" from the agent card on the dashboard.
- The action either focuses an existing linked chat for that pair or creates a new one.
- Surface: dashboard agent card; existing linked-chat code path.

Risk: low. This is wiring, not new behaviour.

### Slice 3 — Interrupt-aware run loop (5-10 days, hardest)

Today, when an agent CLI is processing a prompt, new chat input either queues until current run completes (good) or gets injected immediately and confuses the agent (bad). The interrupt slice changes this for interview-mode chats.

Mechanism:

1. **Mark the linked chat as "interview-active"** while the agent is generating a response.
2. **On new human message during interview-active:**
   - Server sends an interrupt signal to the agent's PTY (Ctrl-C equivalent OR vendor-specific pause).
   - Server captures the partial output the agent had emitted so far (from the run-events buffer).
   - Server constructs a structured interrupt prompt: `{original_prompt, partial_output, interrupt_message}`.
   - Server dispatches the interrupt prompt to the agent as a follow-up turn.
3. **Agent receives** the structured interrupt and decides: incorporate, restart, continue. The decision is the agent's, not ANT's.

Open questions:
- How do we cleanly interrupt Claude Code / Codex CLI / Gemini CLI mid-generation? Each handles SIGINT differently. Likely needs per-CLI shim in `cli-modes.ts`.
- Do we surface partial output to the human in real time, or buffer until interrupt resolves? Real-time is more conversational but reveals abandoned thoughts.

Risk: high. PTY pause semantics differ per CLI; some CLIs don't cleanly resume. Acceptance criterion: works for at least claude-code and codex-cli, with documented limitations for others.

### Slice 4 — Publish-summary action (2-3 days)

- At any point in an interview, human or agent can hit "Publish summary".
- Triggers a structured turn for the agent: "Generate a summary of this interview to post to room <room_slug>. Format: title, 3-5 bullet findings, links to specific message IDs that anchor each bullet."
- Agent emits the summary as a normal message in the linked chat.
- ANT picks up the structured summary, posts it as a new message in the origin room with a back-link header: "Interview summary from @agent and @human, full transcript: <linked-chat-url>".

Surface: button in linked-chat header; new server endpoint POST /api/chat/:linked_id/publish-summary.

Risk: low. Builds on existing chat-send + room-routing primitives.

## What This Replaces

Today: human copies/pastes a chat exchange into Notion or asks the agent to "write that up in markdown for me", manually pastes into the team room. Three steps, three context switches.

After: one-click "Start interview" → talk → "Publish summary" → done. Zero copy-paste.

## What This Does Not Solve

- Multi-human interview (two humans + one agent). Not a current ask.
- Cross-machine interview (interviewing a teammate's agent). Blocked on the cross-machine teammate endpoint + sandbox model.
- Interview transcripts as searchable evidence beyond the linked chat itself. Solvable later via existing surfacing system.

## How This Differs From Cursor / Claude Projects / ChatGPT Voice

Cursor's chat is single-shot prompt-and-pray; no interrupt-aware streaming pause. ChatGPT Voice handles turn-taking elegantly inside the OpenAI app but cannot publish a structured summary back into a team chat or coordinate with other agents on the same task. Claude Projects has chat history but no voice and no interrupt. ANT's combination — voice in, interrupt-aware mid-stream, publish-back to the team room with back-link — is the integration play, not a single primitive.

## Slot In The Deck

Slide 8 of the v2 outline. Single slide. Anchors the "what makes ANT worth using" claim alongside slide 2's unmodified-CLI-orchestration novelty.
