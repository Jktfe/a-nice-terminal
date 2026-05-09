---
name: chat-routing
description: Compact ANT chat routing primer for agents posting into rooms, using @mentions, and avoiding accidental interrupts.
aliases: [chat, routing, chattools, routingtools]
---

# ANT Chat Routing Skill

Use this before posting into ANT rooms when routing matters. The exact
text in the message controls who gets interrupted.

## Routing Rules

- Plain message: posts to the room and notifies idle participants.
- Bare `@handle`: interrupts that one agent or terminal.
- Bare `@everyone`: interrupts all participants.
- Bracketed `[@handle]`: informational reference only; it should not
  route as a direct interrupt.
- If you want one Windows or remote ANT in the loop, explicitly include
  its bare handle in the message.

## Good Room Updates

Keep updates short and operational:

```text
@evolveantclaude M1 is ready for review. Scope: files A/B. Tests: X/Y.
```

For broadcast status:

```text
M2 is active. I am editing only ChatSidePanel and tests.
```

## Before Posting PASS

Check:

1. You reviewed the exact files or live evidence.
2. You can name the tests or smoke checks.
3. You are not accepting a lane you did not inspect.
4. The plan/task state matches the claim.

## Avoid

- Do not tag `@everyone` for routine chatter.
- Do not self-spam with your own handle unless testing routing.
- Do not write long design essays when the room only needs ACK/PASS/BLOCKED.
- Do not say "done" while a build, CI run, or live smoke is still pending.

Long form: `docs/multi-agent-protocol.md`.
