# LlamafileDriver — Observations

**Agent:** llamafile (Mozilla)  
**Version:** v0.9.3  
**Binary:** `~/llamafiles/granite-vision-3.3-2b.llamafile` (IBM Granite Vision 3.3 2B)  
**Probe date:** 2026-04-14

---

## Interaction Model

llamafile is a self-contained executable bundling llama.cpp + a GGUF model. **No permission TUIs exist.** All ANT interactive event classes are NOT APPLICABLE.

### Modes

```
./model.llamafile --cli -p "prompt"   # one-shot completion → stdout → exit
./model.llamafile --chat              # readline REPL (> prompt)
./model.llamafile --server            # HTTP API on :8080 (llama.cpp API)
```

The model GGUF is embedded — no `-m` flag needed for self-contained llamafiles.

### --cli mode

Pure completion. The binary runs, generates tokens to stdout, then exits. No interaction. `detect()` returns null.

```bash
./granite-vision-3.3-2b.llamafile --cli -p "Say hello" --n-predict 50
```

### --chat mode

Readline REPL. Chat history maintained across turns. Submit with Enter. No permission prompts.

---

## Probe Results

Direct CLI probe attempts in this session hit an "error: unknown argument: " issue when stdin was piped (empty stdin treated as an argument). Using explicit `-p` without stdin should work:

```bash
./granite-vision-3.3-2b.llamafile --cli -p "What does this say: test content" --n-predict 100
```

Full P01–P10 probe run: **TODO** (not yet executed due to session constraints).

---

## Event Class Coverage

| Class | Status |
|-------|--------|
| `permission_request` | N/A — no filesystem/bash access in default modes |
| `multi_choice` | N/A |
| `confirmation` | N/A |
| `free_text` | N/A |
| `tool_auth` | N/A |
| `progress` | Partial — loading logs + streaming ANSI (TODO: validate --chat prompt) |
| `error_retry` | N/A |
