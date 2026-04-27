# Qwen CLI Driver Notes

Observed during Slot 7 on 2026-04-27 with Qwen Code v0.15.3 and local Ollama
model `qwen3.6:latest`.

Launch:

```bash
qwen --model qwen3.6:latest --openai-base-url http://localhost:11434/v1 --openai-api-key ollama --auth-type openai --yolo
```

Results:

- Non-interactive smoke test returned `QWEN_OLLAMA_OK`.
- Interactive TUI reached YOLO mode and stayed persistent.
- Outbound ANTagents check-in worked because Qwen executed `ant chat send`
  through its shell tool.
- Direct inbound `@slotqwen` test returned
  `QWEN_INBOUND_OK active_model=qwen3.6:latest`.
- Local response latency was around 30 seconds.

Driver scope:

- In `--yolo` mode, tool permission prompts were not observed.
- Tool execution is treated as `progress`, not as `permission_request`.
- The CLI exposes `--output-format text/json/stream-json`, `--json-fd`,
  `--json-file`, and `--input-file`; the current ANT room route uses PTY/TUI
  output.
