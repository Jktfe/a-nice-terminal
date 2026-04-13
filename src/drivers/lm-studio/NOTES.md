# LmStudioDriver — Observations

**Agent:** LM Studio CLI (`lms`)  
**Version:** `~/.lmstudio/bin/lms`  
**Models available:** openai/gpt-oss-20b (20B, loaded)  
**Probe date:** 2026-04-14

---

## Interaction Model

LM Studio CLI is a pure completion tool. **No permission TUIs exist.**

### Key `lms chat` flags

```
lms chat <model>                         # interactive readline
lms chat <model> --prompt "text"         # non-interactive, streams + exits
lms chat <model> --system-prompt "..."   # custom system prompt
lms chat <model> --stats                 # show prediction stats
lms chat <model> --yes                   # auto-answer CLI prompts
```

### Non-interactive mode (P01 probe equivalent)

```bash
lms chat openai/gpt-oss-20b --prompt "Read this: $(cat file.txt)"
```

Response from `openai/gpt-oss-20b` (gpt-oss, 20B local reasoning model):
```
<think>
User wants content of file, but we don't have it. Probably cannot.
</think>
I'm sorry, but I don't have access to that file's contents.
```

Note: The model responded that it cannot access files (it received the file content in the prompt but misunderstood). The `<think>...</think>` block shows reasoning before the response.

---

## Confirmed Patterns

- `<think>` / `</think>` tags wrap reasoning output in the response stream
- Model cannot access the filesystem — file content must be passed in the prompt
- No permission prompts, tool authorisation, or structured interactive events

## TODO

- Validate the interactive REPL prompt string (`You:` / `AI:` or similar) — not directly observed
- Check if `--stats` output has any structured patterns useful for driver

## Event Class Coverage

| Class | Status |
|-------|--------|
| `permission_request` | N/A — no filesystem/bash access |
| `multi_choice` | N/A |
| `confirmation` | N/A |
| `free_text` | N/A |
| `tool_auth` | N/A |
| `progress` | Partial — `<think>` blocks observed; streaming ANSI TODO |
| `error_retry` | N/A |
