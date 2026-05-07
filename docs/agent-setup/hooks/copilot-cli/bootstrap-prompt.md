# Copilot CLI — install ANT status wrapper

Paste this into Copilot CLI on the host where you want it installed.

---

You are setting up the ANT status wrapper for GitHub Copilot CLI. Read
`docs/agent-setup/state-schema.json` and
`docs/agent-setup/hooks/copilot-cli/NOTES.md`.

**Install location**: `~/.copilot/hooks/ant-status/`.

**Install**:

1. `copilot-state-wrapper.sh` — fronts the `copilot` invocation,
   reads stdin/stdout, writes state file per the inferred-event
   table in NOTES.md. Generates `session_id` (UUID v4) at start.

2. `write-state.sh` — atomic merge-write to
   `~/.ant/state/copilot-cli/<id>.json` and
   `~/.copilot/state/<id>.json`.

3. `classify.sh` — perspective wrapper, used on the assistant tail
   when the trailing prompt marker is seen.

**Then either**:

- Alias `copilot` to invoke the wrapper:

  ```bash
  alias copilot='~/.copilot/hooks/ant-status/copilot-state-wrapper.sh'
  ```

- Or have ANT spawn the wrapper instead of `copilot` directly.

**Verify** by running a Copilot session and watching
`~/.ant/state/copilot-cli/*.json`.

**Caveat**: `Menu` and `Permission` states aren't reliably detectable
from outside Copilot. Expect only `Available`/`Working`/`Response
needed`/`Waiting` for now.

When done, write a one-paragraph status report listing files created
and how you wired the wrapper (alias / ANT spawn / direct).
