# Pi — hook notes

## Status

**Different integration model.** Pi is a JSONL/RPC structured-channel
agent rather than a TUI with hooks. Lifecycle "events" are RPC frames
on stdin/stdout, not shell-hook callouts.

ANT's existing Pi driver (`src/drivers/pi/driver.ts`) consumes the RPC
frames directly. The hook concept here is **a state-file emitter that
listens to the same RPC stream** and writes the unified state file —
giving ANT (and any other consumer) a non-RPC observation surface.

## Implementation pattern

Two options, depending on your install:

### Option A — wrapper script

Wrap `pi` invocations with a script that pipes stdout through a
filter:

```bash
pi "$@" 2>&1 | tee >(pi-state-emitter.sh "$SESSION_ID")
```

`pi-state-emitter.sh` parses each JSONL frame for type signals and
writes state file. Runs alongside Pi at zero overhead.

### Option B — fork the driver

If you control Pi's startup, have it write the state file natively
on session_start / turn_end / idle. Cleanest but requires Pi build
cooperation.

## Event mapping

JSONL frame types and their state mapping:

| Frame `type`            | State                |
|-------------------------|----------------------|
| `session_init`          | `Available`          |
| `user_input`            | `Working`            |
| `tool_call`             | bump `last_edit_ts`  |
| `assistant_response_end`| classifier verdict   |
| `user_input_required`   | `Response needed`    |
| `permission_request`    | `Permission`         |

## State-file location

Preferred: `$HOME/.ant/state/pi/<session_id>.json`
Legacy:    `$HOME/.pi/state/<session_id>.json`

## Quirks

1. **Pi's `session_id` is the framework session, not user-typed.**
   Same session may persist across multiple human "logins". Don't
   reset `session_start` mid-stream; bind it to the first
   `session_init` per process.

2. **Classifier on `assistant_response_end`** — the frame typically
   carries `.text` or `.content` with the rendered output. Use that
   directly; no need to tail a transcript file.

3. **`Menu` state** — Pi exposes structured choice prompts as a
   `multi_choice_prompt` frame type with options inline. Set
   `state: 'Menu'` and `menu_kind: null` (since `AskUserQuestion` is
   a Claude-Code-specific tool name).
