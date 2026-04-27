# Pi CLI Notes

Probe date: 2026-04-27
Detected version: 0.67.6

Pi should be available on `PATH`; check with `which pi` and `pi --version`.

Useful modes for ANT:

- `pi --mode json`: emits JSONL session events.
- `pi --mode rpc`: accepts JSONL commands on stdin and returns structured responses.
- `pi --print/-p`: one-shot task mode.
- `pi --continue`, `--resume`, `--session`: persistent session controls.
- `pi --provider`, `--model`: provider/model override controls.

Real probe findings:

- `--mode json` emitted rich lifecycle events: `session`, `agent_start`, `turn_start`, `message_start`, `message_update`, `message_end`, `turn_end`, `agent_end`.
- `--mode rpc` `get_state` returned model metadata, context window, streaming state, compaction state, session id, and pending message counts.
- Local default model was `ollama/glm-ocr:latest`; the schema was excellent but the model did not follow a trivial `Reply with exactly OK` prompt, so model selection matters.

ANT recommendation:

- Use Pi RPC as the first structured-control prototype for dashboards/status.
- Keep PTY/tmux as the visual terminal lane.
- Build a transport adapter before using `PiDriver.respond`; keyboard emulation is the wrong abstraction for RPC mode.
