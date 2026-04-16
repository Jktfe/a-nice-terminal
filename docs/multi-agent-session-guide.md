# Running a multi-agent session — practical guide

This guide captures the coordination patterns that work in practice when
running multiple AI CLI agents through ANT. It's based on a real session
where Claude Code, Codex CLI, and GitHub Copilot collaborated to prepare
ANT for open-source release — reviewing code, writing tests, scrubbing
secrets, and shipping documentation, all coordinated through a single ANT
chat session.

For the underlying protocol (key conventions, delegation rules, verification),
see [multi-agent-protocol.md](multi-agent-protocol.md).

---

## 1. Set up the session

Create one shared chat session that all agents will use for coordination:

```bash
ant sessions create --name "Sprint: <goal>" --type chat
```

Connect each agent's terminal to ANT, then have them introduce themselves
in the chat:

```bash
ant chat send <session-id> --msg "Hi, I'm <agent>, running in <context>. I can help with <capabilities>."
```

This establishes who's present and what each agent can do.

---

## 2. Assign roles with clear ownership

Every agent needs a defined lane. Overlap causes confusion; gaps cause
dropped work. Assign roles explicitly in the chat:

**Pattern that works:**

| Role | Owns | Examples |
|------|------|----------|
| **Lead / Approver** | Security, task approval, sign-off, task list | Review all changes, merge authority, unblock others |
| **Tests / UX** | Test coverage, build health, UX quality | vitest setup, unit tests, integration tests, build warnings |
| **Docs / OSS** | Documentation, community files, marketing | LICENSE, README, CONTRIBUTING, CI/CD, issue templates |

**Rules:**
- One agent must own the task list and sign-off authority
- No task merges without the lead's review
- Agents can push back on the plan before it's locked

---

## 3. Create a phased plan

Break work into phases with clear dependencies. Post the full plan in chat
and wait for all agents to confirm or push back before creating tasks.

**Pattern that works:**

```
Phase 1 — [Blocking work] (Lead, immediate)
Phase 2 — [Core deliverables] (Agent B, after Phase 1)
Phase 3 — [Parallel work] (Agent C, parallel with Phase 2)
Phase 4 — [Ship] (All, after Phases 2-3)
```

State dependencies explicitly: "Phase 2 starts after Phase 1 lands."

---

## 4. Use checkpoints, not status polling

Agents should report at agreed milestones, not on a timer. The lead
sets checkpoints when assigning tasks:

```
"Report back when vitest is wired up and the grid fix lands —
I'll review before you move to the next task."
```

If an agent is silent too long, one status ping is fine. Two means
something is wrong — investigate or reassign.

---

## 5. @mention routing for targeted messages

- **@handle** — routes to that agent's terminal (they see it as input)
- **Broadcast** (no @mention) — goes to all participants
- **@everyone** — explicit broadcast

Use targeted @mentions for task assignments and status requests.
Use broadcasts for status updates and plan changes.

---

## 6. Unblock aggressively

If an agent is stuck or slow on a task, the lead should:

1. Pick up the task themselves (fastest)
2. Reassign to another agent
3. Simplify the task scope

**Don't wait.** In the reference session, the lead (Claude) ended up
delivering 80% of the work by picking up tasks when other agents stalled.
This is normal and expected — the lead's job is to keep momentum, not
to distribute work evenly.

---

## 7. Rebuild after every source edit

When the server runs from build output (`npm run build`), source edits
make the build stale. Every agent that modifies source files must run:

```bash
npx vite build
```

Failure to rebuild causes 500 errors from stale chunks. Make this a
team rule, not an assumption.

---

## 8. Security-first phasing

Always scrub secrets and personal data before other work begins:

1. Rotate any committed API keys (they're burned)
2. Add secrets to `.gitignore`
3. Replace hardcoded paths with dynamic values (env vars, `window.location`)
4. Audit for personal data in tracked files
5. Plan git history rewrite if needed (destructive — needs human sign-off)

Other phases can start in parallel on work that doesn't touch secrets,
but integration tests and public-facing docs should wait until the
scrub is verified clean.

---

## 9. Task lifecycle

```
proposed → accepted → doing → review → done
```

- **proposed**: created but not yet picked up
- **accepted**: an agent has claimed it
- **doing**: work in progress
- **review**: work done, awaiting lead sign-off
- **done**: signed off and complete

Use `ant task <session> create/accept/review/done` to track state.
The lead marks tasks done after review — agents don't self-approve.

---

## 10. Why this is cheaper than MCP or agent loops

ANT's coordination model is deliberately low-token by design:

**No MCP tool tax.** MCP-based coordination requires each agent to run an
MCP server, register tools, and pay schema tokens on every invocation.
ANT agents coordinate via plain text injected into their PTY — the same
input path they already use. Zero additional tool definitions, zero
schema overhead.

**No polling loops.** Framework-based agent orchestrators (AutoGen,
CrewAI, LangGraph) typically run polling loops where agents repeatedly
check for new messages or tasks. ANT pushes messages directly into
each agent's terminal via the two-call PTY injection protocol. Agents
only consume tokens when they actually have something to process.

**No system prompt bloat.** The wake ritual (section 1 of
[multi-agent-protocol.md](multi-agent-protocol.md)) is ~1-2k tokens,
paid once per session. Memory reads are on-demand, not loaded into
every turn's system prompt. Compare this to MCP where every connected
tool's schema is injected into every request.

**Plain text over structured protocols.** Messages arrive as plain
text strings (`[antchat message for you] '...'`). Agents parse them
with their existing language understanding — no JSON schema validation,
no tool-call formatting overhead, no retry loops for malformed responses.

**Convention over configuration.** The mempalace uses key prefixes
(`tasks/`, `agents/`, `goals/`) instead of typed schemas. Adding a new
coordination pattern is one `ant memory put` command, not a new tool
definition, SDK update, and deployment.

**The result:** In a real 25-task session with 3 agents, the coordination
overhead (chat messages, task updates, @mention routing) was a small
fraction of total token spend. The vast majority of tokens went to
actual work — reading code, writing tests, editing files. That ratio
inverts in MCP-heavy setups where tool schemas and polling consume
more tokens than the work itself.

---

## 11. What we learned

From the reference session (3 agents, 25 tasks, ~2 hours):

- **The lead carries the load.** Plan for the approver to do 60-80% of
  actual delivery, not just review. Other agents contribute but need
  more direction than expected.
- **Checkpoints > polling.** Asking "are you done?" every 5 minutes
  wastes everyone's context. Set explicit milestones.
- **Reverts happen.** Other tools (linters, IDE saves, git operations)
  can revert changes. Always verify before marking done.
- **Test artifacts leak.** Integration tests that create sessions will
  broadcast to live participants. Gate integration tests behind env vars.
- **Small tasks > big tasks.** "Write 15-20 tests" stalls. "Set up
  vitest, then write CLI arg tests, then write auth tests" delivers.
- **The chat is the record.** Status updates in chat create an auditable
  trail of who did what and why. Don't skip them.
