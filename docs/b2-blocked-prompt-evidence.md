# B2 Blocked Prompt Visibility Evidence

Branch: `delivery/b2-blocked-prompt`

Worktree: `../a-nice-terminal-b2-blocked-prompt`

## Scope

- Prompt bridge detections now require an existing terminal CLI driver signal from `cli_flag` or `meta.agent_driver`.
- Prompt bridge pending prompts emit `session_needs_input` and `session_input_resolved` WebSocket status messages for the existing dashboard/sidebar status path.
- Dashboard and activity rail show a global waiting counter from current needs-input state.
- `/api/sessions/:id/status` includes pending prompt-bridge state so the focused terminal context strip can show the prompt summary after reload.
- No run_events schema, projector, raw transcript, PTY transport, or trust-tier rendering changes.

## Verification

Commands run from the B2 worktree under Node 20:

```bash
./node_modules/.bin/svelte-kit sync

env PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH ./node_modules/.bin/vitest run tests/prompt-bridge.test.ts
# PASS: 1 file / 7 tests

env PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH ./node_modules/.bin/vitest run
# PASS: 18 files / 109 tests, 1 skipped

env PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH npx --yes svelte-check
# PASS: 0 errors / 0 warnings

env PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH ./node_modules/.bin/vite build
# PASS
```
