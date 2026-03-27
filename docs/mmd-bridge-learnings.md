# MMD Bridge Learnings
> Captured from the MMD-Learning multi-model chat room build session (2026-03-26)

---

## 1. ANT Terminal Input — Two-Call Protocol

**Problem:** Sending `"command\r"` or `"command\n"` in a single `ant_terminal_input` call doesn't execute the command. The text appears but Enter never fires, leaving the shell at the prompt with the command typed but unrun.

**Root cause:** ANT processes terminal input sequentially — text and the Enter keystroke need to be distinct events, and there must be a small processing gap between them.

**Fix:**
```typescript
// WRONG — one call with \r or \n appended
await ant_terminal_input({ sessionId, data: "my-command\r" });

// CORRECT — text first, then newline as separate call
await ant_terminal_input({ sessionId, data: "my-command" });
await ant_terminal_input({ sessionId, data: "\n" });
```

**Why `\r` shows literally:** When `\r` is sent in JSON it is a valid carriage return character, but in some terminal states (bracketed paste mode, readline handling) it renders as literal `\r` rather than triggering execution. A plain `\n` (newline) is more reliably interpreted as "run the command" in zsh/bash.

**Additional pitfall:** If context is lost mid-session and you re-enter a terminal, the old command may still be in the readline buffer. Always send `\u0003` (Ctrl+C) first to clear it before typing a new command.

---

## 2. MLX-LM + Mistral Tokenizer Fix

### The Problem

When loading any Mistral-family model via `mlx_lm.server`, you get:

```
UserWarning: The tokenizer you are loading from '...' with an incorrect
regex pattern `(?i:'s|'t|'re|'ve|'m|'ll|'d)`. This is a known issue.
You can set `fix_mistral_regex=True` flag...
```

The `(?i:...)` inline case-insensitive flag is PCRE syntax. Rust's `regex` crate (used by the `tokenizers` library) does not support inline flags — only whole-pattern flags. So the tokenizer fails to compile the pre-tokenizer regex.

### Why the built-in fix doesn't work automatically

The `transformers` library (v5.3.0) has `_patch_mistral_regex()` in `tokenization_utils_tokenizers.py`, but two bugs prevent it from auto-applying:

**Bug 1 — Default is `False`:**
```python
# Line ~446 in tokenization_utils_tokenizers.py
fix_mistral_regex=kwargs.get("fix_mistral_regex"),  # defaults to None → False
```
The fix only runs when `fix_mistral_regex=True` is explicitly passed. Since `mlx_lm` never passes it, the fix never runs.

**Bug 2 — Wrong attribute assumption:**
```python
# Line ~1328
current_pretokenizer = tokenizer.backend_tokenizer.pre_tokenizer
# AttributeError: 'tokenizers.Tokenizer' object has no attribute 'backend_tokenizer'
```
The function receives a raw `tokenizers.Tokenizer` (the Rust backend object), but was written assuming it receives a `PreTrainedTokenizerFast` (the Python wrapper). The backend object IS the thing you'd normally access via `.backend_tokenizer`.

### The Fix — Two edits to `tokenization_utils_tokenizers.py`

**Edit 1** (~line 446) — apply fix by default:
```python
# Before:
fix_mistral_regex=kwargs.get("fix_mistral_regex"),
# After:
fix_mistral_regex=kwargs.get("fix_mistral_regex", True),
```

**Edit 2** (~line 1328) — handle both object types:
```python
# Before:
current_pretokenizer = tokenizer.backend_tokenizer.pre_tokenizer

# After:
bt = tokenizer.backend_tokenizer if hasattr(tokenizer, "backend_tokenizer") else tokenizer
current_pretokenizer = bt.pre_tokenizer
# ... then use `bt` everywhere instead of `tokenizer.backend_tokenizer`
```

Full patched block:
```python
bt = tokenizer.backend_tokenizer if hasattr(tokenizer, "backend_tokenizer") else tokenizer
current_pretokenizer = bt.pre_tokenizer
if isinstance(current_pretokenizer, tokenizers.pre_tokenizers.Sequence):
    bt.pre_tokenizer[0] = split_pretokenizer
else:
    if isinstance(current_pretokenizer, tokenizers.pre_tokenizers.Metaspace):
        current_pretokenizer = tokenizers.pre_tokenizers.ByteLevel(
            add_prefix_space=False, use_regex=False
        )
    bt.pre_tokenizer = tokenizers.pre_tokenizers.Sequence(
        [split_pretokenizer, current_pretokenizer]
    )
```

**File location:**
```
~/.local/pipx/venvs/mlx-lm/lib/python3.13/site-packages/transformers/tokenization_utils_tokenizers.py
```

**Note:** Don't try to pass `fix_mistral_regex=True` via `mlx_lm.server`'s `tokenizer_config` dict — it triggers `TypeError: got multiple values for keyword argument 'fix_mistral_regex'` because `transformers` extracts it from `**kwargs` internally.

### HuggingFace Blob Cache (less reliable approach)

You can also patch the tokenizer JSON directly at:
```
~/.cache/huggingface/hub/models--<org>--<model>/blobs/<hash>
```
Replace `(?i:'s|'t|'re|'ve|'m|'ll|'d)` with `(?:'s|'t|'re|'ve|'m|'ll|'d|'S|'T|'RE|'VE|'M|'LL|'D)`.

**But** this only silences the raw JSON warning — if transformers generates the warning from its own Python layer independently (which v5.3.0 does), it won't help. Fix the library source instead.

---

## 3. Bridge Script Architecture — What Works

### The Poll Loop Pattern

Every bridge uses the same core loop:

```typescript
async function poll() {
  const messages = await fetchMessages();           // GET /api/sessions/:id/messages

  // First run — sync cursor, don't respond
  if (lastSeenAt === null) {
    lastSeenAt = messages[messages.length - 1].created_at;
    for (const m of messages) processedIds.add(m.id);
    return;
  }

  // Find new messages
  const newMessages = messages.filter(
    m => m.created_at > lastSeenAt! && !processedIds.has(m.id)
  );

  // Advance cursor
  lastSeenAt = messages[messages.length - 1].created_at;
  for (const m of newMessages) processedIds.add(m.id);

  // Respond to relevant ones
  for (const msg of newMessages) {
    if (!shouldRespond(msg)) continue;
    const response = await callModel(msg.content);
    await postMessage(response);
  }
}
```

**Why `processedIds` AND `lastSeenAt`:** Timestamps can collide (two messages in the same second). The Set prevents double-processing even with identical timestamps.

### shouldRespond() — keep it narrow

```typescript
function shouldRespond(msg: AntMessage): boolean {
  if (msg.role === "system") return false;           // never respond to system events
  if (msg.sender_name === DAVE_NAME) return false;   // never respond to yourself
  const lower = msg.content.toLowerCase();
  const direct = lower.includes("@yourdave") || lower.includes("yourdave");
  const broadcast = lower.includes("everyone") || lower.includes("all models");
  return direct || broadcast;
}
```

**Critical:** Always filter `msg.sender_name === DAVE_NAME`. Without this, the bridge responds to its own previous messages and loops forever.

### REST vs CLI bridges

| Backend | Pattern | Busy guard needed? |
|---------|---------|-------------------|
| mlx-lm / LM Studio (OpenAI-compat) | `fetch /v1/chat/completions` | No — parallel requests OK |
| llm CLI / Mistral | `spawn("llm", ...)` subprocess | Yes — `llmBusy` flag, skip tick if busy |
| Ollama generate | `fetch /api/generate` | Yes — one request at a time |

For subprocess-based backends, use a `busy` flag and **skip** (not queue) ticks when busy:
```typescript
if (llmBusy) return;  // skip this tick — don't pile up requests
llmBusy = true;
try { await doWork(); } finally { llmBusy = false; }
```

---

## 4. Smoke Test Strategy for Slow-Loading Models

**Problem:** 24B+ parameter models on Apple Silicon have significant JIT compilation time on first load. A 120s smoke test WILL timeout, causing the bridge to exit before it even starts polling.

**Fix:** Make smoke tests non-fatal:
```typescript
// WRONG — exits on cold-start timeout
const test = await queryLlmCli("Reply with exactly: OK");

// CORRECT — warn and continue
try {
  const test = await queryLlmCli("Reply with exactly: OK");
  console.log(`Smoke test passed: "${test.slice(0, 50)}"`);
} catch (err) {
  console.warn(`Smoke test failed (continuing anyway):`, err.message);
  // Model will still respond once it's loaded — bridge keeps polling
}
```

---

## 5. Process Piping Kills Servers

**Problem:** `mlx_lm.server --model ... 2>&1 | head -30` — piping server output through `head` causes `head` to close its stdin after 30 lines, which sends SIGPIPE to mlx-lm, killing the server.

**Fix:** Never pipe a persistent server's output. Run it clean:
```bash
mlx_lm.server --model wbkou/... --port 8090
```
If you want to inspect startup output, read it via `ant_read_terminal_output_v2` after the server starts.

---

## 6. Context Recovery — Restarting After Session Loss

When a Claude Code session ends mid-setup and all the bridges have stopped, restart in this order:

1. **Identify the conversation session ID** — check `ant_list_sessions` for the conversation, note its ID
2. **Start the model server first** — mlx-lm, llamafile, etc. must be up before the bridge does its startup health check
3. **Start each bridge with the session ID:**
   ```bash
   THINKING_SESSION=<id> bun run scripts/<name>-bridge.ts
   ```
4. **Read startup output** with `ant_read_terminal_output_v2` — look for `"Posted arrival"` and `"Initial sync"` as confirmation
5. **Don't re-use old terminal output** — the screen buffer may show errors from the previous run; check `since` the cursor you last saw

---

## 7. Terminal Output Cursor Tracking

Always track the `seq` cursor from `ant_read_terminal_output_v2` and pass it back as `since` on the next read. Without this you re-read the entire scroll buffer including old errors from previous runs, making it hard to tell what's new.

```typescript
let cursor = 0;
const output = await ant_read_terminal_output_v2({ sessionId, since: cursor });
cursor = output.seq;  // save for next read
```

---

## 8. Model-Specific Trigger Words (Current MMD Setup)

| Dave | Triggers |
|------|---------|
| MLXDave | `mlxdave`, `@mlx`, `@qwen`, `qwendave`, `everyone`, `all of you`, `all models` |
| MistralDave | `mistral`, `mistraldave`, `@llm`, `@mistral`, `everyone`, `all of you`, `all models` |
| OllamaDave | `@ollama`, `@ocr`, `@vision`, `@ollamadave` — **vision/OCR only, requires file path** |
| LMDave | `lmstudio`, `lmdave`, `@lm`, `everyone`, `all of you`, `all models` |
| LlamafileDave | `llamafile`, `llamafiledave`, `@llama`, `everyone`, `all of you`, `all models` |

OllamaDave is intentionally **not** broadcast-triggered — it only runs when explicitly @mentioned with a file path. Broadcasting to it would result in "I need a file path" responses every time.

---

## 9. Known Remaining Issues

### MistralDave — Cold Start Timeout
The `llm` CLI (llm-mlx plugin) takes >120s to JIT-compile `Mistral-Small-24B-4bit` on first use. Smoke test is non-fatal so the bridge starts, but the first actual response request will also timeout. Second+ requests after model is warm will work. Consider increasing the timeout in `queryLlmCli` to 300s for the first real query.

### LMDave — Catch-Up Responses
When the bridge restarts after downtime, it processes all new messages since it last ran. If those messages contain trigger words, it responds to them even if they're hours old. This is by design (consistency) but can flood the chat on restart. Consider adding a max-age filter: skip messages older than 10 minutes on startup.

### OllamaDave — `deepseek-v3.1:671b-cloud` in Model List
This cloud-proxied model appears in the Ollama tags list but is not a local model. It shouldn't cause issues for OllamaDave since it's vision/OCR only, but worth knowing the Ollama instance has it loaded.

---

## 10. Infrastructure Map (Current State)

```
MMD-Learning conversation (TLjxs3eqPk3S)
│
├── REST bridges (poll & respond autonomously)
│   ├── mmd-mlx-bridge      → mlx-lm :8090  (Qwen3.5-27B Opus distil)
│   ├── mmd-lmdave-bridge   → LM Studio :1234  (GPT-OSS-20B)
│   ├── mmd-mistral-bridge  → llm CLI  (Mistral-Small-24B)
│   └── mmd-ollama-bridge   → Ollama :11434  (vision/OCR only)
│
├── Model servers
│   ├── mmd-mlx-server      → mlx_lm.server on :8090
│   └── [llamafile server not running — bridge skipped]
│
└── ANT Bridge (a-nice-terminal)
    └── Handles fan-out to Claude Code / Gemini / Codex terminals
```
