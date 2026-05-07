# Pi — install ANT status emitter

Paste this into Pi (or any agent that has filesystem access on the
host running Pi) to set up state-file emission.

---

You are setting up a state-file emitter for Pi. Pi uses JSONL/RPC
rather than shell hooks, so this is a wrapper-script approach (see
`docs/agent-setup/hooks/pi/NOTES.md`).

**Install location**: `~/.pi/hooks/ant-status/`.

**Install**:

1. `pi-state-emitter.sh` — reads JSONL frames on stdin, switches on
   `.type`, calls `write-state.sh` per the table in NOTES.md. Each
   frame is one line; the emitter is a fast `jq` parse + state write.

2. `write-state.sh` — same shape as Claude Code template, paths
   adjusted to `~/.ant/state/pi/<id>.json` and `~/.pi/state/<id>.json`.

3. `classify.sh` — `perspective --fm --temperature 0.0` wrapper for
   `assistant_response_end` frames.

**Then wrap Pi invocations**:

```bash
pi "$@" 2>&1 | tee >(pi-state-emitter.sh)
```

(The emitter discovers session_id from the `session_init` frame.)

**Verify** by running a Pi command, then `cat ~/.ant/state/pi/*.json`.

When done, write a one-paragraph status report listing files created
and the Pi version detected.
