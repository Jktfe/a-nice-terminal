---
name: chat-break
description: Compact ANT chat-break primer for using /break, bounded context, and long-memory rooms without rereading the full design doc.
aliases: [break, context, breaktools, contexttools, chatbreaktools]
---

# ANT Chat Break Skill

Use this when a room is long-running, a user says "fresh start", or an
agent needs to understand how much room history it should consider.

## Mental Model

- `/break` posts a `chat_break` marker into the room.
- Agents see only messages after the latest break by default.
- Human readers still see the full room history in the UI.
- The room-level `Long memory` toggle makes agents ignore breaks and use
  full history.

Breaks save tokens by making a room a channel, not an ever-growing prompt.

## When To Use

Use `/break` after:

- a feature lane closes;
- a debugging theory is abandoned;
- a room changes purpose;
- the user wants a clean context boundary.

Do not use `/break` when the room is intentionally cumulative, such as a
house, personal memory, or long-lived facts room.

## Commands And Surfaces

Post a break:

```bash
ant chat send "$ROOM" --msg "/break wrapped the release sweep"
```

Read bounded context:

```bash
ant chat read "$ROOM"
```

Read full context:

```bash
ant chat read "$ROOM" --full
```

In the web room, use the right-rail **Long memory** setting when the room
should keep all history in agent prompts.

## Agent Rules

- Treat the latest break as the start of the current working context.
- Mention above-break decisions only if the user asks or `--full` was used.
- If you add a new agent-context call site, route it through
  `loadMessagesForAgentContext`.
- Never delete history to save context; use a break marker.

Long form: `docs/CHAT-BREAK.md`.
