# LlmDriver — Observations

**Agent:** `llm` (Simon Willison's LLM CLI)  
**Installed at:** `~/.local/bin/llm`  
**Probe date:** 2026-04-14

---

## Interaction Model

`llm` is a pure one-shot completion CLI. **No permission TUIs, no REPL, no interactive events.**

```bash
llm 'Five names for a pet pelican'     # one-shot completion
llm chat                               # multi-turn readline (uses same models)
llm models list                        # list available models
llm keys set openai                    # configure API key
```

### Default model (at probe time)

`gpt-4o-mini` (OpenAI). No local models configured — API key required for all completions.

### P01 probe attempt

```bash
llm "What does this file say? Quote it: $(cat test-file.txt)" -m 4o-mini
```
Result: `Error: No key found - add one using 'llm keys set openai' or set the OPENAI_API_KEY environment variable`

The tool requires a configured API key. Without one, it exits immediately with a plain-text error.

---

## Event Class Coverage

All ANT event classes are NOT APPLICABLE. `detect()` always returns null.

| Class | Status |
|-------|--------|
| `permission_request` | N/A — CLI exits immediately |
| `multi_choice` | N/A |
| `confirmation` | N/A |
| `free_text` | N/A |
| `tool_auth` | N/A |
| `progress` | N/A — exits before streaming (no API key) |
| `error_retry` | N/A |

## Notes

- `llm chat` launches a multi-turn readline session but still has no interactive TUI events
- Plugins extend the tool (e.g. `llm-ollama` for local models) but don't add interactive dialogs
- The fingerprinting pipeline can re-run once an API key is configured
