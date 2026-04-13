# OllamaDriver — Observations

**Agent:** Ollama  
**Version:** (check `ollama --version`)  
**Models available:** gemma4:26b, glm-ocr:latest, deepseek-v3.1:671b-cloud  
**Probe date:** 2026-04-14

---

## Interaction Model

Ollama is a pure completion REPL. **No permission TUIs exist.** The ANT event classes `permission_request`, `multi_choice`, `confirmation`, `free_text`, `tool_auth`, and `error_retry` are not applicable.

### Interactive mode: `ollama run <model>`

```
>>> Send a message (/? for help)
```

User types a message at `>>> ` and presses Enter. The model responds with streaming tokens. The `>>> ` prompt re-appears when generation is complete.

**Submit key:** Enter

**REPL commands:**
- `/exit` or `/bye` — quit
- `/clear` — clear history
- `/?` — show help

### Non-interactive mode: `echo "prompt" | ollama run <model>`

Accepts stdin as the prompt, streams the response to stdout, then exits. No readline REPL.

---

## Confirmed Output Patterns

### Loading / thinking spinner (raw ANSI)

During model load and initial thinking, Ollama emits ANSI cursor control sequences wrapping braille spinner characters:

```
[?2026h[?25l[1G⠙ [K[?25h[?2026l
```

Decoded: hide cursor → move to column 1 → braille char + space → clear to EOL → show cursor. Rotates through: `⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏ ⠋`

### "Thinking..." line

Appears for reasoning models (deepseek, gemma4 in think mode) before the actual response:
```
Thinking...
```

### Token streaming

Each token is emitted with `[?25l` (hide cursor) + character + `[?25h` (show cursor). After stripping ANSI the response is plain text.

### Idle state

```
>>> Send a message (/? for help)
```
The `>>>` prompt indicates the REPL is idle and waiting for input.

---

## Event Class Coverage

| Class | Status |
|-------|--------|
| `permission_request` | N/A — Ollama has no file/bash access |
| `multi_choice` | N/A |
| `confirmation` | N/A |
| `free_text` | N/A |
| `tool_auth` | N/A |
| `progress` | ✓ Spinner + streaming tokens |
| `error_retry` | N/A |
