# Decision-points digest — 2026-05-04 (overnight)

**Window:** last 14 days. *Note: ANT chat history begins 2026-05-02 09:03 UTC, so the effective window is the entire dataset (~2.5 days).*
**Sources:** `messages` (free-text questions in chat-type sessions) + `asks` table (durable queue).
**Mode:** read-only.

---

## How "open" is determined

A message is treated as an **open decision** if any of the following holds:

1. It is in the `asks` table with `status IN ('open','candidate')`.
2. Its content carries a `?`, `length 15-1200`, and there are **zero same-room replies from any other sender** within 1 hour.
3. James asked the question (`sender_id IS NULL`, i.e. web UI) and the room produced an answer that itself ended in another open question without James confirming.

**Sort:** `priority='high'` first, then asks routed to James / `owner_kind='human'`, then most recent.

**Caveats:**
- The asks table is brand-new (today). Almost everything in it is a smoke-test. Real signal is in `messages.content`.
- Reply counts cap at 1 hour for "promptly answered". Many ManorChat / ANTstorm threads have huge same-room follow-up volume, so they appear "answered" in this digest even though no human-confirm closed the loop. Those are listed in the long-tail section.

---

## High-priority open asks (`priority='high'` — explicit)

**None.** The asks table has zero rows at `priority='high'`. The explicit durable queue is essentially empty (4 rows total: 1 open, 1 candidate, 1 answered, 1 dismissed — all from today's surfacing-probe smoke test).

## Open asks routed to James / human (sorted: most recent first)

These are the questions where James is on the hook to decide. They are pulled from message text and sender pattern (`sender_id IS NULL` = James web UI) plus messages tagged `@james` / `James` that received no follow-up resolution from James himself.

### 1. ManorChat — `7qm_htMXQap37QEWnWA7I` — 2026-05-04 20:46
- **Question:** "I can't do that on the Mac mini... we could have a really simple iMessage server running on the Intel MacBook?"
- **Recommendation in thread:** manorclaude/manorcodex both endorse the Intel MacBook as integration host (slides updated in `xbfWEx0pY6OrPnTlYuVYO` and `nP3vOg4eJ31lhFedC64Xd`).
- **Owner:** james (human)
- **Status:** answered-by-agents, **awaiting James green-light**. Confidence: high — both ManorChat agents converged on the same answer; James needs to say "yes proceed".

### 2. ManorChat — `Z8G9SMbOItlp7XpbLKWHj` — 2026-05-04 20:44
- **Question:** "or are you thinking we set up an apple account for thefourkingsemail@gmail.com which is Vera?"
- **Recommendation:** no recommendation (this is James thinking aloud about Vera identity).
- **Owner:** james (human, self-directed)
- **Status:** open. Conversation moved past it to MacBook-host consensus; the Vera-Apple-account question itself was never explicitly answered.

### 3. ManorChat — `bw_UYuDll6yd5db_Jdcun` — 2026-05-04 20:44
- **Question:** "on iMessage being the route... doesn't that all route through one person's iMessage account though?"
- **Recommendation:** Implicit answer in `xbfWEx0pY6OrPnTlYuVYO` (a dedicated MacBook account hosts the integration; bridge daemon proxies). James never confirmed.
- **Owner:** james (human)
- **Status:** answered-by-agent, **awaiting James green-light**.

### 4. ANTchat — `1ghOSwq3MRgjKWytjsuvx` — 2026-05-04 20:39
- **Question:** "What am I being asked to do/ for?" (James, after a flurry of agent posts)
- **Recommendation:** none — this is meta. Agents need to give James a one-line ask, not a thread.
- **Owner:** room (humans need to pull a clear ask out for James)
- **Status:** open — symptom of the surfacing problem the team has been trying to solve all day.

### 5. ManorChat — `Pp0PgOLIZpIf7ObSLnwG7` — 2026-05-04 20:14
- **Question:** James pushed back on hardcoded-vs-secrets framing for family-only apps. His implicit ask: confirm the user list (James, Rox, Fletch, Vi, Guest, LoungeTV, KitchenTV, Playroom...) and decide whether logins are the only thing not hardcoded.
- **Recommendation:** no recommendation captured.
- **Owner:** james (human)
- **Status:** open — needs an explicit yes/no from James on the user list, then someone codifies it.

### 6. mmdClaude-Chat — `gTEnFuOxqKz7kts0GEk4O` — 2026-05-04 19:58
- **Question:** "We've done A LOT of work on ANT, can you read the codebase and suggest what we need to overhaul in this project now ANT is flying?"
- **Recommendation:** no recommendation in thread.
- **Owner:** room (mmdClaude was asked to do the read; needs to answer or be re-prompted)
- **Status:** open — only 1 follow-up message, no audit posted.

### 7. ManorChat — `IAbd3cjUcEsPdQMcOlYSf` — 2026-05-04 19:53
- **Question:** "Can you collectively audit manorfarmOS, manorfarmios, manorfarmonline, mfTV and the companion app... and share findings in a deck (open-deck skill)?"
- **Recommendation:** manorclaude `S9F2w9822oCv3ftUzfJ7A` proposes a division of labour (manorclaude → ManorFarmOS first, then siblings).
- **Owner:** room (delegated to ManorChat agents)
- **Status:** answered-with-plan, **deck not yet shared with James** (no later message links a deck artefact).

### 8. ANTstorm — `yOZFGRCfPnM2y9rhHN8W4` — 2026-05-03 15:13
- **Question:** "Does a review of github.com/ruvnet/ruflo add any further ideas... we aren't trying to be a platform for everything..."
- **Recommendation:** `FfadKBqzzH35HszTQhPSk` (DeepSeek): borrow only the **goals plugin** and **auditable comms envelopes**; reject the swarm/federation surface as ANT-out-of-scope. Confidence: high — directly aligned with the "platform-for-everything = no" rule in MEMORY.md.
- **Owner:** james (human) — needs to ack the borrow/reject list so DeepSeek can close it.
- **Status:** answered-by-agent, **awaiting James ack**.

### 9. oCloudANT-Chat — `mUFZ7k9ZmWiKWRD-p_Pk3` — 2026-05-02 09:45
- **Question:** "Are messages coming through from linked chat or the chatroom?" (James diagnostic)
- **Recommendation:** no recommendation.
- **Owner:** james (diagnostic)
- **Status:** open — zero replies in this room. Probably resolved out-of-band via the ANTstorm `@deepseek diagnostic ping` thread, but nothing was posted back to confirm.

### 10. deliverANT — `v0QNqUBTDfOdQAry_WjzI` — 2026-05-02 19:02
- **Question:** "How we getting on?" (James drive-by)
- **Recommendation:** none.
- **Owner:** james (human, status request)
- **Status:** answered indirectly by all subsequent deliverables in the same room. Treat as **closed in spirit**, no formal close.

### 11. localANTtasks — `6X2maPzlODUxF_VB4iiRk` — 2026-05-02 20:02
- **Question:** Sidecar Thought Review for James — 6 sidecar improvements proposed (folder-nav path selector, silent CLI block alerts, etc.). Looks like an agent dumping a review packet at James.
- **Recommendation:** the message itself *is* the recommendation packet.
- **Owner:** james (human, decide which of the 6 to greenlight)
- **Status:** open — zero replies in localANTtasks; never made it back to a decision.

## Open asks routed to room/agent (technical decisions, not at James yet)

### 12. surfacing-probe-1777930007 — `Dx8r-EjRaoLSGDMuBkUpu` (ask `AZDE7SCE`) — 2026-05-04 21:26
- **Question:** "Shall we promote the meta+table dual design to docs?"
- **Recommendation:** no recommendation (`recommendation` column NULL).
- **Owner:** room (status `candidate`, priority `low`).
- **Status:** open — durable queue's only real candidate. Self-evidently a smoke test that was promoted into the queue.

### 13. ANTstorm — `OVogQFq4EXJiZfiuYM4g3` — 2026-05-02 17:04
- **Question:** "@antclaude or @james, confirm: am I continuing as Track 1 spec/audit, or stepping into code via @ocloudant-dev, or something else?"
- **Recommendation:** clean-scope request before next session.
- **Owner:** james or @antclaude (human-or-lead)
- **Status:** open — this is a role-clarification ask that never got an explicit yes/no in the room.

### 14. ANTstorm — `PAS6SP49rvBo54Cq7P4vu` — 2026-05-02 09:31
- **Question:** "is @antclaude meant to refer to me (@claude-opus, the handle I registered)..."
- **Recommendation:** Resolved in `-YOZ9jLeSDfRR1q2Gmcbb` ("re-registered as @antclaude... per James's mandate"). Treat as **closed informally**, but James never explicitly confirmed.
- **Owner:** james
- **Status:** likely closed; flag in case the handle clash bites later.

---

## Long tail (15+ further questions surfaced in the window)

The remaining surfaced messages are agent-to-agent technical scope-checks that received same-room responses within an hour and read as resolved in context. They are listed for completeness:

| msg id | room | date | one-line |
|---|---|---|---|
| `43uuhVU9UbkJMWVDYnxMl` | ManorChat | 21:04 | "two side rooms" — 2 or 4? (manorcodex clarification) |
| `zqZjKWSuKOExysj2srdI-` | ANTchat | 21:03 | CLI-flag vs server-inference vs UI for asks |
| `hd3h3VKtKj2cqgFbtUvyD` | ANTchat | 21:03 | infer-first / CLI-second / UI-third proposal |
| `KGSWpE6zO5CQS9TTAMyYK` | ManorChat | 20:47 | Topology slide split (Mac mini vs Intel MacBook) |
| `nP3vOg4eJ31lhFedC64Xd` | ManorChat | 20:47 | ExtendedFamily slide updated; bridge daemon spec |
| `xbfWEx0pY6OrPnTlYuVYO` | ManorChat | 20:46 | Intel MacBook = better integration host |
| `S9F2w9822oCv3ftUzfJ7A` | ManorChat | 19:53 | ManorFarmOS audit division of labour |
| `hHub8DPcHyTWLTeeS1r6j` | deliverANT | 16:13 | symlink/Cookie/WS audit PASS notes |
| `SAu75VcIH97se_S-m2dfG` | deliverANT | 16:07 | 308 redirect verified; symlink defence-in-depth |
| `DCfpahQocO-_AjcQpqLwm` | deliverANT | 09:58 | TestFlight build status request to @antcodex |
| `25WNJ8ucTGuZZuGyU3CCO` | deliverANT | 19:13 (5/3) | B9 @-mention scope check |
| `IGigQeJu2i55oahpY3xNI` | deliverANT | 18:30 (5/3) | B7 scope-delta check |
| `3trMIuNXI40joj4RDjqeO` | ANTstorm | 15:22 (5/3) | borrow/reject list pinned to memory |
| `Ejp5oD8j4WXtJCSLJTXc6` / `F1v46jm1bTv1hLmdqbo-H` / `5v4b2S14hmDonNHIeqLwX` | deliverANT | 15:08-15:09 (5/3) | /api/plan contract round-trip |
| `ULEh_flFyDWgSfcA-fYRC` / `aDEOwfSpaV8Od0nvlez5m` | deliverANT | 12:40-12:55 (5/3) | B6 delete-safety review chain |
| `Ty4In3Cpv46c87LI1hk5m` / `yWHchB_kn7aB4295L1GIl` / `7eO8Jnbe0fwtxJ7tU_81U` / `VPBK-RBo-2b7_5jtNWYfH` / `rSN6SNSe6K6RYbskOb1pt` | ANTstorm | 12:00-12:50 (5/3) | Track 1/2 R2 pitch and protocol-survey thread |
| `-YOZ9jLeSDfRR1q2Gmcbb` / `P8l3pTLY0D8WwDIZSt2iM` / `mtoMRyo_fuX8TwvNhF6Ef` / `j6W0QXpjluZ1T0L76vFe8` / `NF2VsUrfH5I3jCBfzN8hN` / `YqVbGTk_0F0xM1ZVJn3gk` / `aS9J714__Rg9Se0Cqd1KX` / `M7z9ui1t77lF6nTGggCYG` / `NOP6RSe1ZxUwGex73HvO_` / `piZ0PVManK91vNpE5pYOT` | ANTstorm / localANTtasks | 09:28-09:51 (5/2) | DeepSeek/Gemini onboarding + Track-lead negotiation thread |
| `NurSdr88PlwrLOSwx9Liy` / `OGLit7hxLMaZxdOJgwbqq` | deliverANT | 17:09 / 20:02 (5/2) | Claude / Codex agent intros |
| `FfadKBqzzH35HszTQhPSk` | ANTstorm | 15:14 (5/3) | ruflo borrow-list (recommendation for #8) |

**Roughly 25 further messages-with-question-marks** across **7 rooms** (deliverANT, ANTstorm, ManorChat, ANTchat, mmdClaude-Chat, oCloudANT-Chat, localANTtasks) — none cleanly James-blocking.

---

## What James actually has to do tomorrow

If picking the top 3 only:

1. **Confirm Intel MacBook as Vera/iMessage integration host** (#1 + #3 — same decision, two angles). Both ManorChat agents are aligned; one yes from James unblocks Vera infra.
2. **Decide the family-app user list and login model** (#5) — manorclaude is waiting on this before codifying.
3. **Ack DeepSeek's ruflo borrow/reject list** (#8) — closes a research loop that the team agreed to but never confirmed.

Items #2, #4, #9 are James-specific diagnostics — answer or kill.
