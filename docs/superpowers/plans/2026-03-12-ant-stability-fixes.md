# ANT Stability Fixes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix terminal random shutdowns, resize flicker, chat scroll issues, and harden the kill timer lifecycle so sessions survive reliably.

**Architecture:** Five targeted fixes across the server (WebSocket handler race condition, test setup) and client (resize debouncing, terminal init retry, chat auto-scroll). Each fix is independent and can be committed separately.

**Tech Stack:** TypeScript, Socket.IO, xterm.js, FitAddon, Zustand, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/app/server/ws/handlers.ts` | Modify | Fix `checkRoomEmpty` race condition — increase delays, add guard |
| `packages/app/server/__tests__/setup.ts` | Modify | Add `ttl_minutes` column to test schema |
| `packages/app/server/ws/handlers.test.ts` | Modify | Add test for disconnect → kill timer timing |
| `packages/app/src/components/TerminalView.tsx` | Modify | Fix resize double-fire, init retry loop, REPLAY_JUNK_RE regex |
| `packages/app/src/components/MessageList.tsx` | Modify | Scroll to bottom on initial load + message arrival |

---

## Chunk 1: Server-side fixes (kill timer race + test setup)

### Task 1: Fix test setup — add `ttl_minutes` column

The test DB schema is missing the `ttl_minutes` column that was added to production. Tests that create sessions will fail if any code reads `ttl_minutes`.

**Files:**
- Modify: `packages/app/server/__tests__/setup.ts:9-19`

- [ ] **Step 1: Add `ttl_minutes` to sessions table in test schema**

In `packages/app/server/__tests__/setup.ts`, update the `CREATE TABLE sessions` statement to add the column after `archived`:

```sql
    archived INTEGER NOT NULL DEFAULT 0,
    ttl_minutes INTEGER DEFAULT NULL,
```

- [ ] **Step 2: Run tests to verify nothing breaks**

Run: `cd packages/app && npx vitest run`
Expected: All existing tests pass (they don't reference `ttl_minutes` but the column must exist for queries that SELECT *)

- [ ] **Step 3: Commit**

```bash
git add packages/app/server/__tests__/setup.ts
git commit -m "test: add ttl_minutes column to test DB schema"
```

---

### Task 2: Fix `checkRoomEmpty` race condition in WebSocket handlers

When a client disconnects (tab close, network blip), `checkRoomEmpty` fires to decide whether to start the kill timer. The `leave_session` handler uses `setTimeout(0)` and `disconnect` uses `setTimeout(100)`. While `socket.leave()` is synchronous, the real race is on reconnection: if a client disconnects and immediately reconnects (e.g. network blip), the reconnecting client needs time to re-join the room before we check whether the room is empty. With a 0-100ms window, the reconnecting client often hasn't re-joined yet, so the kill timer starts prematurely.

**Fix:** Increase delay to 500ms — gives reconnecting clients time to re-join before we check whether the room is truly empty.

**Files:**
- Modify: `packages/app/server/ws/handlers.ts:111-121` (leave_session)
- Modify: `packages/app/server/ws/handlers.ts:361-370` (disconnect)
- Test: `packages/app/server/ws/handlers.test.ts`

- [ ] **Step 1: Write failing test for disconnect kill-timer delay**

Add a test to `packages/app/server/ws/handlers.test.ts` in the `leave_session` describe block:

```typescript
it("delays checkRoomEmpty to let Socket.IO clean up", async () => {
  seedTestSession("t1", "terminal");
  mockSocket._trigger("join_session", { sessionId: "t1" });
  vi.clearAllMocks();

  mockSocket._trigger("leave_session", { sessionId: "t1" });

  // Kill timer should NOT be called synchronously
  expect(vi.mocked(startKillTimer)).not.toHaveBeenCalled();
});
```

Also need to import `startKillTimer` at the top of the test file (it's already mocked, just needs to be imported for assertion):

```typescript
import {
  createPty,
  getPty,
  hasOutputListeners,
  addPtyOutputListener,
  resizePty,
  destroyPty,
  startKillTimer,
} from "../pty-manager.js";
```

And extend `createMockIo()` to include `sockets.adapter.rooms` (required by `roomHasClients()`):

```typescript
function createMockIo() {
  const connectionHandlers: Function[] = [];
  const rooms = new Map<string, Set<string>>();
  const toRoom = {
    emit: vi.fn(),
  };
  return {
    on: vi.fn((event: string, handler: Function) => {
      if (event === "connection") connectionHandlers.push(handler);
    }),
    to: vi.fn(() => toRoom),
    emit: vi.fn(),
    toRoom,
    sockets: {
      adapter: { rooms },
    },
    _simulateConnection(socket: any) {
      for (const handler of connectionHandlers) handler(socket);
    },
  };
}
```

- [ ] **Step 2: Run test to verify it passes (or fails if currently synchronous)**

Run: `cd packages/app && npx vitest run server/ws/handlers.test.ts`

Note: This test should already pass because the current code uses `setTimeout(0)` which is async. The real fix is the delay increase — the test documents the contract.

- [ ] **Step 3: Increase delay in `leave_session` from 0ms to 500ms**

In `packages/app/server/ws/handlers.ts`, change lines 116-121:

```typescript
    socket.on("leave_session", ({ sessionId }: { sessionId: string }) => {
      if (typeof sessionId !== "string" || !sessionId.trim()) return;
      socket.leave(sessionId);
      joinedSessions.delete(sessionId);

      // 500ms delay: gives reconnecting clients time to re-join the room before
      // we check emptiness. Too short → kill timer starts before re-joining client arrives.
      setTimeout(() => {
        checkRoomEmpty(io, sessionId);
      }, 500);
    });
```

- [ ] **Step 4: Increase delay in `disconnect` from 100ms to 500ms**

In `packages/app/server/ws/handlers.ts`, change lines 361-370:

```typescript
    socket.on("disconnect", () => {
      for (const sessionId of joinedSessions) {
        // 500ms: match leave_session delay for consistency
        setTimeout(() => {
          checkRoomEmpty(io, sessionId);
        }, 500);
      }
      joinedSessions.clear();
    });
```

- [ ] **Step 5: Run all tests**

Run: `cd packages/app && npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/app/server/ws/handlers.ts packages/app/server/ws/handlers.test.ts
git commit -m "fix: increase checkRoomEmpty delay to 500ms to prevent premature kill timers"
```

---

## Chunk 2: Terminal rendering fixes (resize flicker + init timing + regex)

### Task 3: Fix resize double-fire and terminal init timing

Two problems:
1. Both `window.resize` event AND `ResizeObserver` call `fitAddon.fit()` — doubling the work on every resize
2. Terminal init uses a single 100ms fallback if container isn't sized — no retry

**Fix:**
1. Remove the `window.resize` listener entirely — the `ResizeObserver` already handles it (and is more reliable since it watches the actual container, not just window size)
2. Replace the single 100ms timeout with a polling loop (check every 50ms, up to 1s)

**Files:**
- Modify: `packages/app/src/components/TerminalView.tsx`

- [ ] **Step 1: Remove window resize handler**

In `TerminalView.tsx`, find the `handleResize` function and `window.addEventListener("resize", handleResize)` block (around line 319-325). Remove the function definition and the add/remove event listener calls.

Remove:
```typescript
    // Handle resize
    const handleResize = () => {
      try { fitAddon.fit(); } catch {}
      sendResize();
    };

    window.addEventListener("resize", handleResize);
```

And in the cleanup function, remove:
```typescript
      window.removeEventListener("resize", handleResize);
```

The `ResizeObserver` (with its 50ms debounce) already covers window resizes because the container changes size when the window resizes.

- [ ] **Step 2: Replace init timing with retry loop**

Replace the init block (around lines 254-270) that uses `requestAnimationFrame` + `setTimeout(100)` with a polling approach:

```typescript
    // Wait for container to have dimensions before opening xterm.
    // Poll every 50ms up to 1s — handles CSS animations, sidebar transitions, etc.
    let initAttempts = 0;
    let initPollTimer: ReturnType<typeof setTimeout> | null = null;
    const tryInit = () => {
      initAttempts++;
      if (container.offsetWidth && container.offsetHeight) {
        term.open(container);
        term.focus();
        try { fitAddon.fit(); } catch {}
        sendResize();
        attachViewportScroll();
      } else if (initAttempts < 20) {
        initPollTimer = setTimeout(tryInit, 50);
      } else {
        // Last resort: open anyway — xterm will use fallback dimensions
        term.open(container);
        term.focus();
        try { fitAddon.fit(); } catch {}
        sendResize();
        attachViewportScroll();
      }
    };
    const initTimer = requestAnimationFrame(tryInit);
```

**IMPORTANT:** The cleanup function must also clear `initPollTimer` to prevent polling after unmount. In the cleanup return block, add after `cancelAnimationFrame(initTimer)`:

```typescript
      cancelAnimationFrame(initTimer);
      if (initPollTimer) clearTimeout(initPollTimer);
```

- [ ] **Step 3: Fix REPLAY_JUNK_RE to catch bare DA1 responses**

The current regex requires `?` or `>` after `[` but standard DA1 responses are `ESC[c` or `ESC[0c` (no `?` or `>`).

Replace line 18:
```typescript
const REPLAY_JUNK_RE = /\x1b\[[?>][\d;]*c|\x1b\[\d+;\d+R|\x1b\[\d*n/g;
```

With:
```typescript
const REPLAY_JUNK_RE = /\x1b\[\??[>]?[\d;]*c|\x1b\[\d+;\d+R|\x1b\[\d*n/g;
```

This makes both `?` and `>` optional, matching:
- `\x1b[c` (bare DA1)
- `\x1b[0c` (DA1 with param)
- `\x1b[?0;276;0c` (DA1 with `?`)
- `\x1b[>65;4807;0c` (DA2 with `>`)

Also update `TERM_RESPONSE_RE` (line 12) — only match DA responses ending in `c`, DSR ending in `n`, and CPR ending in `R`. Do NOT use a broad `[a-zA-Z]` final character class as that would match arrow keys and other legitimate sequences:

```typescript
const TERM_RESPONSE_RE = /^\x1b\[\??[>]?[\d;]*c$|^\x1b\[\d+;\d+[Rn]$|^\x1b\[\d*n$/;
```

- [ ] **Step 4: Verify terminal still works**

Run the dev server: `cd packages/app && npx tsx server/index.ts`
Manual test:
1. Open terminal → should appear without flicker
2. Resize browser window → should resize smoothly without double-jump
3. Toggle sidebar → terminal should refit correctly
4. Type commands → arrow keys, tab completion should work
5. Run `htop` or `vim` → interactive apps should render correctly

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/TerminalView.tsx
git commit -m "fix: remove resize double-fire, add init retry loop, fix DA1 regex gap"
```

---

## Chunk 3: Chat scroll fixes

### Task 4: Fix MessageList scroll — always start at bottom, auto-scroll on new messages

Two problems:
1. On initial load, messages render but the list starts at the top — user must scroll down
2. Auto-scroll only works if already near bottom (`isNearBottom`) — new messages from streaming arrive but are invisible

**Fix:**
1. Add an effect that scrolls to bottom when messages first load (non-empty → scroll)
2. Always scroll to bottom when a new message arrives (not just when near bottom) — but still respect user selection

**Files:**
- Modify: `packages/app/src/components/MessageList.tsx:56-60`

- [ ] **Step 1: Add scroll-to-bottom on initial message load**

Add a `useEffect` after the existing scroll effects (around line 54) that fires once when messages go from empty to populated:

```typescript
  // Scroll to bottom when messages first appear (page load / session switch)
  const hasScrolledInitial = useRef(false);
  useEffect(() => {
    if (messages.length > 0 && !hasScrolledInitial.current) {
      hasScrolledInitial.current = true;
      // Use requestAnimationFrame to ensure DOM has rendered
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: "instant" });
      });
    }
    if (messages.length === 0) {
      hasScrolledInitial.current = false;
    }
  }, [messages]);
```

- [ ] **Step 2: Update auto-scroll to handle new messages more aggressively**

Replace the existing auto-scroll effect (lines 56-60):

```typescript
  // Auto-scroll on new messages only when user is already at bottom AND not selecting
  useEffect(() => {
    if (isNearBottomRef.current && !isSelectingRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);
```

With a version that also scrolls when the message count changes (new message added):

```typescript
  // Auto-scroll when new messages arrive or content updates (streaming)
  const prevMessageCount = useRef(messages.length);
  useEffect(() => {
    const isNewMessage = messages.length > prevMessageCount.current;
    prevMessageCount.current = messages.length;

    // Always scroll for new messages (unless user is selecting text)
    if (isNewMessage && !isSelectingRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    // For streaming updates (same count, content changed), only scroll if near bottom
    if (isNearBottomRef.current && !isSelectingRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);
```

- [ ] **Step 3: Verify chat behaviour**

Run the dev server: `cd packages/app && npx tsx server/index.ts`
Manual test:
1. Open a conversation session → messages should be visible at bottom
2. Send a new message → view should scroll to show it
3. Scroll up → new messages from streaming should NOT force scroll (user is reading history)
4. But a new complete message arriving should scroll down
5. Select text → auto-scroll should not interrupt selection

- [ ] **Step 4: Run all tests**

Run: `cd packages/app && npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/MessageList.tsx
git commit -m "fix: chat always scrolls to bottom on load, auto-scrolls on new messages"
```

---

## Verification Checklist

After all tasks:

- [ ] `cd packages/app && npx vitest run` — all tests pass
- [ ] Start dev server and open ANT in browser
- [ ] Create a terminal session — no flicker on init, fills container
- [ ] Resize browser window — smooth resize, no double-jump
- [ ] Toggle sidebar — terminal refits correctly
- [ ] Close browser tab, reopen within 15 min — session still alive
- [ ] Wait >15 min with tab closed — session correctly killed (default TTL)
- [ ] Set session to AON — confirm it survives indefinitely
- [ ] Open conversation session — messages visible at bottom
- [ ] Send messages — auto-scrolls to show them
- [ ] Type `ls`, arrow keys, tab in terminal — input not swallowed
