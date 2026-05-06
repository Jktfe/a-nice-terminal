# ANT Honest Assessment

Date: 2026-05-05
Status: Synthesis draft 4. Inputs: positioning-matrix-2026-05-05.md (claude), four critic responses (Gemini headless + Kimi/GLM/DeepSeek via `codex exec --oss -m <model>:cloud`), James's field notes (2026-05-05 conversation), James's threat-model clarification (cross-machine = shared-doc-scoped, not RCE), final-pass additions from GLM + DeepSeek folded into the rendered deck.

Critical reframe in draft 3: the four critics solved the wrong cross-machine threat model. Their unanimous "RCE/sandbox/capability-tokens" finding assumed remote agents would execute on local hardware. James's actual ask is the opposite — agents collaborate on shared documents while each side queries its own user's local context and writes answers (with sources) into the shared doc. The OSS blocker softens dramatically; the novelty sharpens.

Three additions in draft 4 (folded in from the rendered deck — GLM + DeepSeek final pass):
1. **Shared artefacts are advisory unless locally approved.** Cross-machine writes land as proposals on the receiving side, not as faits accomplis. The recipient's user/agent must accept before the artefact mutates. Stops "agent A wrote into the shared doc and agent B is implicitly consuming whatever lands".
2. **Provenance must be bidirectional.** Both sides can audit who-asked-what AND who-answered-with-what-source. Earlier drafts only specified provenance on the answer side. Bidirectional is the actual chain-of-custody requirement.
3. **Shared doc/git conflicts need an explicit conflict lane.** When two agents (or two users) write to the same region or push to the same branch, conflicts route to a chat thread scoped to that region. Not a UI surprise; a conversation primitive.

The rendered deck (17 slides, manifest verified, ANT proxy 200, direct Open-Slide 200) is at:
- `/Users/jamesking/CascadeProjects/ANT-Open-Slide/ant-strategy-assessment-2026-05-05/`
- ANT view: `https://localhost:6458/deck/ant-strategy-assessment-2026-05-05/s/ant-strategy-assessment`
- Direct: `http://127.0.0.1:5186/s/ant-strategy-assessment`

Kimi missed the final-pass time-box (read local context, didn't return). That miss is itself slide-12 evidence — even the critic-panel-as-pipeline missed one of its own inputs. Worth a one-line callout in the deck.

## Executive Answer

The three live questions James posed:

1. **Just for me + my team?** Today, yes — but the path off "just for me" is shorter than draft 2 implied. The cross-machine ask is doc-scoped (shared documents, agent-to-agent question-and-answer, no remote shell), not machine-scoped (remote code execution). Open-Slide's manifest already IS the doc-scope substrate. The missing primitive is an agent-to-agent ask-protocol with a constrained question/answer shape, not a microVM sandbox.
2. **Wasted time?** No. Worst case still yields reusable primitives — Open-Slide manifest, surfacing system, prompt-bridge, PTY identity routing, agent-to-agent ask-protocol — that extract cleanly as standalone utilities.
3. **Genuinely worth open-sourcing?** More likely yes than draft 2 said. Two defensible novelties now: (a) orchestrating *unmodified* CLI agents into multiplayer, (b) **local-context-meets-shared-doc** — each side's agent brings private local context (emails, contacts, files) into a shared output with cited sources. The OSS gate is no longer "RCE-grade sandbox" but "doc-scope sync + ask-protocol with consent gates on what local context can be surfaced".

## The Two Real Novelties (after threat-model reframe)

### Novelty 1 — Unmodified CLI orchestration

**ANT orchestrates unmodified CLI agents into multiplayer.** Aider, Claude Code, Codex CLI, Gemini CLI, Kimi (via Codex --oss), Aider+Ollama — each runs as the vendor shipped it, with no library wrapping, no API substitution, no harness. ANT achieves coordination through PTY scraping + standard I/O injection + identity-routed chat fan-out. Every other multi-agent framework surveyed (AutoGen, CrewAI, LangGraph, MetaGPT, OpenAI Swarm, Sloppy) requires you to model the agent inside their library. ANT consumes vendor agents as-is.

Three product consequences:
- **No vendor lock-in.** When a new CLI ships next month, it joins ANT by being launched in a terminal. No SDK update needed.
- **Real agents, not stubs.** What you see is what's running on your machine. The chat history, tool calls, and evidence pipeline reflect actual agent behaviour, not a wrapper's interpretation.
- **Federated-by-construction.** Each agent is a real OS process. Cross-machine federation is a transport problem, not an orchestration rewrite.

### Novelty 2 — Local-context-meets-shared-doc

This one only emerges once you reframe cross-machine the way James does. The shared doc isn't where the agents *run*; it's where they *meet*. Each side has a local-context agent that knows its own user's emails, contacts, files, conversation history. When the shared doc needs an answer that requires private context — "who at Brown Rudnick handled the Acme matter in Q1?" — one agent asks the other, the other's agent searches its own user's local context, writes an answer with sources back into the shared doc.

Closest comparisons: a two-sided Granola (which only does one user's meeting capture); Slack-where-each-person-has-an-inbox-search-AI (which doesn't exist); Notion AI (which only sees its own workspace). None of them give you the "your agent asks my agent something my agent can answer from my private data" shape with provenance attached.

The Stevo example: lawyer A and lawyer B drafting a joint memo. Lawyer A's agent asks "who was opposing counsel on the Acme matter, dates, key filings". Lawyer B's agent searches B's email + matter management + calendar, returns a sourced answer that drops into the shared doc with citation links. No email round-trip. No screen-share. No "let me check and get back to you tomorrow". Both users keep their own context private; only the answer crosses the boundary.

Slides 1 and 2 carry these two novelties as a pair.

## Where ANT Is Just Fancier Tmux + Chat Panel

Gemini named the DIY substitute precisely: tmuxinator layouts + Slack webhooks for routing + native CLI agents in panes + `script` for durable logging. With one weekend and three Slack apps, a power user gets ~70% of what ANT does.

What that DIY stack still misses (per the matrix):
- Routing a message to `@codex` such that one specific agent receives it and others don't.
- Deterministic deck export with provenance hash and conflict guard.
- Auto-detection of interactive prompts surfaced as asks (the surfacing system shipped 2026-05-04).
- PID-tree identity that survives reconnects.
- Open-Slide as evidence-as-output with React-bundle determinism.

The honest framing for slides: ANT is *the integration*, not any single primitive. Each piece is replicable; the combination is rare. That is a defensible product story for an opinionated power user, and a fragile one for a generic market.

## The Actual Cross-Machine Threat Model

Critics unanimously assumed cross-machine meant *remote code execution* — your agent runs on my hardware, my agent runs on yours. That is the threat model that demands microVM sandboxing and capability tokens. James's actual ask is simpler and stricter:

**Each agent only ever writes to its own machine. Cross-machine is chat + structured feedback only.**

Two concrete use cases drive the design:

### Use case A — Doc collaboration (the Stevo example)

Two professionals draft a shared document. Each user has a local-context agent (their own email, contacts, calendar, matter files). When a question arises that needs the other side's private context — "who handled the Acme matter for you in Q1?" — agent A asks agent B, agent B searches B's local context, writes a sourced answer into the shared doc. The shared doc is the only place context crosses. Open-Slide manifest already provides the doc-scope substrate.

### Use case B — Code collaboration on a feature request (the GVPL example)

James owns the GVPL product. A team member (or external collaborator) requests a feature — "different way of displaying the dashboard that does X". James spins up an agent on *his own machine* to do the work. A chatroom opens with four participants: James, James's agent (the doer), the team member, the team member's agent (the witness/feedback channel).

Flow:
- James briefs his agent in the chat.
- James's agent writes code on James's machine only.
- When James's agent thinks it has delivered, it checks in with the team member ("here's what I changed, does this match what you wanted?").
- Team member iterates with feedback in chat. Their agent helps articulate, surfaces things they noticed, references their own context — but never writes to James's machine.
- If it gets back to James needing approval for further work, James's agent asks James, not the team member.
- The only place where the team member's agent does any actual machine work is on their own machine — for example, an installation step or a local-config fix specific to their environment. Even then, that work is on their machine, reported back as feedback.

Critical invariant for both use cases: **remote agent NEVER writes to my machine, only feedsback.** No microVM. No capability tokens for remote execution. No default-deny tool policy. The threat model is dramatically smaller than the critics assumed.

What is genuinely needed:
- **Cross-machine chat transport.** Tailscale/WireGuard already does this; the integration is making @handle routing work across hosts.
- **Agent-to-agent ask-protocol.** A constrained Q&A shape so "B's agent answers using B's context" doesn't smuggle execution into the answer slot.
- **Consent gates on what local context can be surfaced — with scope-of-grant UX.** When agent B is about to share content from a private email or file, B sees a one-line consent prompt before it leaves the machine. Per-query consent at >5 prompts/min gets disabled by users; need scope-of-grant (topic + time + count, e.g. "answer up to 5 questions about Acme matter from email + calendar for the next 30 minutes"). This extends the surfacing system already shipped 2026-05-04 to a new domain.
- **Bidirectional provenance on every cross-machine answer.** The Open-Slide manifest pattern — sha256, source URI, audit log — applied to chat messages that originated as private-context lookups, on both ask and answer sides. Each user can audit their own outflow AND inflow.
- **Advisory-by-default writes.** Cross-machine artefact mutations land as proposals on the receiving side. Recipient must accept before the artefact mutates. Same primitive whether it's a shared doc, a deck slide, or a git push — the receiving side is always an active participant, never a passive merge target.
- **Conflict lane.** When two agents (or two users) write to the same region or push to the same branch, conflicts route to a chat thread scoped to that region. Conflicts are conversations, not UI surprises.

None of those need a microVM. All of them are extensions of substrate that already exists. The OSS gate softens from "build a sandbox" to "ship the ask-protocol + scope-of-grant consent + advisory writes + conflict lane + bidirectional provenance".

## James's Field Notes Folded In

Five product slides emerged directly from the 2026-05-05 conversation:

### Slide: Agent Turn-Taking Primitive
Three modes — race (current default), round-robin (turn token), ping-pong (back-and-forth). Per-room claim lock with quick-release shortcut, visible in chat header. Today's "two agents jumping the same task" failure (claude jumped ahead of codex on Sloppy synthesis) is the opening anecdote.

### Slide: Interview / Voice Mode (North Star)
Click agent in dashboard → "Start interview" → opens linked-chat for that human+agent pair. Voice composer affordance with VAD-detect auto-send (Wispr Flow already does the speech-to-text). Interrupt-aware run loop: when human posts mid-response, server pauses streamed output, hands the agent (current-partial, original-prompt, interrupt-message), agent decides incorporate vs restart. Publish-summary action posts structured findings back to the origin room with a back-link. This is the single most ambitious slide in the deck and the most direct expression of James's "talk to an agent like you talk to a person" goal.

### Slide: Per-Agent Casting (Honest Strengths)
- Claude: logic, but jumps too fast → primary planner / reviewer with turn-taking lock applied.
- Codex: momentum, but needs a nudge loop → primary doer with claude-on-loop pairing for stalled-state detection.
- Gemini: visual lane occupant but not delivering → consider replacement (v0/Bolt for UI gen, claude+chrome+computer-use for visual verification, Pencil MCP for design-file work).
- Gemma local + felt-templates work: strong on discrete jobs, under-used → route discrete tasks to local models for cost.
- Codex+ollama cloud: unexpected positive, worth doubling down.

### Slide: Dashboard Nav Friction
Field note: too many clicks back to context. Possible primitives: sticky context bar with one-click return; keyboard palette (⌘K) for jump-to-room/jump-to-terminal; pinned-thread shortcut. Cursor's command palette and Warp's launch configs are the comparison.

### Slide: iPhone App Trust + PWA Path
Field note: iPhone app not crashing but not trusted; James prefers Safari. Slide content: PWA-as-primary-mobile until app crash story is rebuilt; instrumentation gap to identify why mobile app is suspect.

## Refreshed Slide Outline (v2)

Provisional 14-slide deck. Up for trim before content writing.

1. **Vision** — James's verbatim brief.
2. **The one real novelty** — orchestrating unmodified CLI agents into multiplayer.
3. **What ANT is today** — substrate map (terminal sessions, chat rooms, evidence pipeline, identity, manifests).
4. **What works (with receipts)** — surfacing system, deck integrity, multi-agent coordination, prompt bridge, PID-tree identity.
5. **Per-agent casting (honest strengths)** — Claude/Codex/Gemini/Gemma assessment.
6. **What still hurts** — terminal smoothness, interactive capture, plan presentation, skill universality, autonomous-coding hit-or-miss.
7. **Agent turn-taking primitive** — race / round-robin / ping-pong, claim lock, quick release.
8. **Interview / voice mode (north star)** — interrupt-aware run loop + publish-summary action.
9. **Visual-agent gap + replacement bets** — v0/Bolt, claude+chrome+computer-use, Pencil MCP.
10. **Dashboard nav + iPhone-app trust** — PWA-as-primary, sticky context bar.
11. **Honest comparison** — DIY tmux+Slack+Notion stack vs ANT (Gemini's frame).
12. **Open-source readiness gap** — security model, sandbox, approval gates, marketplace.
13. **Product-market honest call** — just-for-team vs real product; signals to watch.
14. **Next 4 weeks** — turn-taking primitive, interview-mode prototype, sandbox spike, OSS readiness checklist.

Codex's role on this round (per James): challenge the synthesis, not scaffold ahead.

## Critic Panel — Four Independent Voices

After James pointed me at `codex exec --oss -m <model>:cloud`, the panel was reachable. Four independent critics ran the same provocation. Convergence is striking — but draft 3 has to mark where they converged on the wrong threat model.

### "Unanimous" finding that solved the wrong problem (4/4)

All four critics assumed cross-machine = remote-code-execution and wrote rejection vectors and remediations against that:

- **Gemini**: "Remote agents running arbitrary commands on my local hardware is an unacceptable risk." Fix: microVM/Docker sandboxing + strict approval gates.
- **Kimi**: "Unaudited, pre-OSS software with root-adjacent terminal access, Tailscale-exposed, known capture bugs." Fix: open the source, sandbox each agent in separate user namespaces, ship the turn-taking primitive.
- **GLM**: "Cross-machine means another user's agent sends my agent a message that fans out to terminal execution on my machine. That's an RCE surface with no capability scoping, no consent gate, no sandbox boundary." Fix: scoped capability tokens + human-in-the-loop default + revocable per-session grants.
- **DeepSeek**: "One hallucinated `rm -rf` and my machine is a brick." Fix: containerized/VM-sandboxed agents by default + filesystem access as scoped per-room opt-in.

James's clarification reframes this. Cross-machine in ANT's design is chat + structured feedback only; remote agents never write to local hardware. The critics' analysis is still useful as the *upper bound* threat model — it tells us what we'd need if we ever did want remote-execution federation. But the actual product gate is much smaller: doc-scope sync + ask-protocol + consent gates on private-context surfacing. Shared git repos are explicitly NOT remote execution — each agent commits/pushes from its own machine and the other side pulls when ready, which is the same risk profile any technical team carries.

Slide implication: keep the critics' framing as a "what if you wanted full federation" sidebar, but the main slide on cross-machine pivots to the doc-scope-and-ask-protocol architecture.

### Triple-confirmed (3/4): PID-tree identity is the most novel ANT primitive

- **Kimi**: "Cloud agents and orchestration libraries do not treat terminal session ancestry as identity, nor do they give you a cryptographically auditable, offline-capable evidence trail."
- **GLM**: "AutoGen/CrewAI pass identity as metadata; they don't verify it from the OS. This is a real integrity primitive."
- **DeepSeek**: "Walking the process tree through fork/exec to infer which agent spawned which terminal is a genuinely novel, terminal-native identity primitive. It's also the most fragile part of the system — but it's original."
- **Gemini** framed novelty differently (unmodified-CLI orchestration) — complementary, not contradictory.

### Triple-confirmed (3/4): Durable evidence pipeline with sha256/manifest is novel

- **Kimi**: "ANT's real differentiation is the audit-logged slide-deck export with SHA256/write-conflict guard."
- **GLM**: "Audit-compliance-grade provenance, not just logging. Devin has replay but no exportable artifact with integrity proof."
- **DeepSeek**: "Borrows from regulated-industry chain-of-custody patterns — nobody in the agent space thought to bring that in."

### Sharp deltas — observations only one critic raised

- **Gemini**: Reframed novelty as orchestrating *unmodified* CLI agents into multiplayer (no library wrapping, no SDK lock-in). This is the cleanest framing of why ANT's substrate beats AutoGen/CrewAI for someone who already uses Aider+Claude Code+Codex.
- **Kimi**: The asks/decisions queue as first-class structured objects (not chat scrollback) was singled out. Worth a slide.
- **GLM**: "A pipeline that misses events isn't a pipeline, it's a sieve. The novelty is real but currently undelivered." Direct hit on the interactive-capture-inconsistency weakness — the evidence pipeline's value is proportional to capture consistency.
- **DeepSeek**: "Some of this novelty is 'nobody else thought it mattered,' not 'breakthrough insight.'" Calibrated honesty worth quoting in the deck. Also the killer cross-machine question: "What am I coordinating between machines that I can't do on one? If the answer is 'we'll figure it out,' I'm not installing." Demands a concrete cross-machine use case before any cross-machine engineering.

## Honest Re-Score After Threat-Model Reframe

Draft 2 had the OSS gate at ~65% pending sandbox + capability tokens. Draft 3, with the threat model corrected, moves the numbers materially.

- **Just for me + my team:** ~55% likely. Down from ~85%. Cross-machine ask-protocol + consent gates are achievable extensions of substrate that already exists; James now has two concrete use cases (Stevo doc-collab, GVPL code-collab) that anchor the design. The remaining 55% is execution risk, not threat-model risk.
- **Genuinely worth open-sourcing:** ~80% likely. Up from ~65%. The two novelties are now stable: unmodified-CLI orchestration + local-context-meets-shared-doc. Both are deck-worthy on their own. Both extend cleanly without needing microVM-grade sandboxing.
- **Wasted time:** still <20%. Even worst case, four primitives — PID-tree identity, sha256 manifest, asks/decisions queue, agent-to-agent ask-protocol — extract cleanly as standalone open-source utilities.

## Updated Slide Outline (v4)

17 slides. One pivots, three reshape, none added.

1. **Vision** — James's verbatim brief.
2. **Two novelties, one substrate** — unmodified CLI orchestration AND local-context-meets-shared-doc. Both ride on PTY scraping + identity routing + Open-Slide manifest.
3. **What ANT is today** — substrate map.
4. **What works (with receipts)** — surfacing system, deck integrity, multi-agent coordination, prompt bridge, PID-tree identity.
5. **Per-agent casting (honest strengths)** — Claude/Codex/Gemini/Gemma assessment.
6. **What still hurts** — terminal smoothness, interactive capture, plan presentation, skill universality, autonomous-coding hit-or-miss.
7. **Agent turn-taking primitive** — race / round-robin / ping-pong, claim lock.
8. **Interview / voice mode (north star)** — interrupt-aware run loop + publish-summary.
9. **Visual-agent gap + replacement bets** — v0/Bolt, Claude+Chrome+computer-use, Pencil MCP.
10. **Dashboard nav + iPhone-app trust** — PWA-as-primary, sticky context bar.
11. **Honest comparison** — DIY tmux+Slack+Notion vs ANT (Gemini's frame).
12. **Pipeline-or-sieve.** GLM frame: novelty is real but currently undelivered until interactive capture is consistent.
13. **Cross-machine use cases — Stevo + GVPL.** Doc-collab (lawyers drafting joint memo with private-context lookups) and code-collab (feature request workflow with chat + feedback only, never remote execution). Both anchor on the same invariant: remote agent never writes to my machine.
14. **Doc-scope the sync, not the universe.** Where draft 2 had "microVM the universe" as the OSS blocker, draft 3 reframes: agent-to-agent ask-protocol + consent gates on private-context surfacing + provenance on every cross-machine answer. Shared git repos are explicitly normal-team risk, not RCE. The critics' microVM/capability-token analysis is the upper-bound threat model, not the actual one.
15. **PID-tree identity + audit-grade evidence** — the two primitives that survive critic pressure.
16. **Product-market honest call** — just-for-team vs real product; the threat-model reframe moves the OSS-worth gate from 65% to 80%.
17. **Next 4 weeks** — turn-taking primitive, interview-mode prototype, ask-protocol spike, consent-gate prototype, cross-machine chat transport.

## What's Still Pending

- **Qwen3-coder-next**: model not yet downloaded (48GB), deferred. Worth pulling overnight if the deck pass continues.
- **James's trim/add on outline v4** before content writing begins.
- **Slide 1 + slide 13 calibration check**: drafted on James's request to confirm tone before full deck.
- **Re-run critics with corrected threat model**: provocation v2 should describe cross-machine as "shared docs / git + ask-protocol, no remote execution" and ask which OSS blocker survives that frame. Likely outcome: critics still flag consent gates and provenance, but microVM/capability-token language drops out.
