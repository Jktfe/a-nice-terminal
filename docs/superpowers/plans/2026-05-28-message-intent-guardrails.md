# Message Intent Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build zero-token guardrails that make replies explicit, reduce wrong-room posts, and flag cross-room mentions before messages are sent.

**Architecture:** Add a top-level `ant chat reply <messageId>` command that resolves the parent message through the server, derives the room id, and posts through the existing message endpoint with `parentMessageId`. Keep v1 deterministic: command shape, message id lookup, room membership checks, and explicit override flags.

**Tech Stack:** SvelteKit API routes, persisted SQLite stores, Node/Bun CLI scripts, Vitest.

---

### Task 1: Top-Level Reply Command

**Files:**
- Modify: `scripts/ant-cli-chat.mjs`
- Modify: `scripts/ant-cli-chat.test.mjs`
- Modify: `src/lib/cli-manifest/manifest.ts`
- Modify: `docs/capability-ledger.md`

- [ ] **Step 1: Write the failing CLI test**

Add a test that calls:

```js
await handleChatVerb('reply', ['msg_parent', '--stdin'], runtime, { CliInputError });
```

The runtime should return `{ message: { id: 'msg_parent', roomId: 'room-a' } }` for `GET /api/chat-rooms/messages/msg_parent`, then accept `POST /api/chat-rooms/room-a/messages` with `{ parentMessageId: 'msg_parent' }`.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
nvm exec 22 npm test -- scripts/ant-cli-chat.test.mjs
```

Expected: fail with `unknown chat verb: reply`.

- [ ] **Step 3: Implement minimal reply command**

Add `reply` to `KNOWN_CHAT_ACTIONS`, parse positional `messageId`, fetch `/api/chat-rooms/messages/:messageId`, then post to the returned `roomId` with `parentMessageId`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
nvm exec 22 npm test -- scripts/ant-cli-chat.test.mjs
```

Expected: all chat CLI tests pass.

### Task 2: Message Lookup Endpoint

**Files:**
- Create: `src/routes/api/chat-rooms/messages/[messageId]/+server.ts`
- Create: `src/routes/api/chat-rooms/messages/[messageId]/server.test.ts`

- [ ] **Step 1: Write endpoint tests**

Test 200 for an existing visible message and 404 for a missing message. Use the existing room-read gate after loading the parent message room so hidden rooms do not leak.

- [ ] **Step 2: Implement endpoint**

Use `getMessageById(messageId)`, `findChatRoomById(message.roomId)`, and `requireChatRoomReadAccess(request, room)`; return `{ message }`, hiding missing rows behind 404.

### Task 3: Deterministic Guardrails

**Files:**
- Modify: `scripts/ant-cli-chat.mjs`
- Modify: `scripts/ant-cli-chat.test.mjs`

- [ ] **Step 1: Reply-shaped broadcast warning**

Warn when `ant chat send` contains `reply-to=msg_...` or a `msg_...` reference without `--parent-message`, unless `--broadcast-ok` is present.

- [ ] **Step 2: Cross-room mention guard**

After resolving room membership, warn or fail for `@handle` mentions that are known but not members of the target room. Require `--allow-cross-room-mentions` for explicit override.

### Task 4: Docs and Release

**Files:**
- Modify: `src/lib/cli-manifest/manifest.ts`
- Modify: `docs/capability-ledger.md`

- [ ] **Step 1: Document safe usage**

Add examples:

```bash
ant chat reply msg_abc123 --stdin <<'EOF'
reply body
EOF
```

- [ ] **Step 2: Full verification**

Run:

```bash
nvm exec 22 npm test -- scripts/ant-cli-chat.test.mjs src/routes/api/chat-rooms/messages/[messageId]/server.test.ts src/lib/cli-manifest/manifest.test.ts
nvm exec 22 npm run check
nvm exec 22 npm run build
bun run build:cli:arm64-darwin
```
