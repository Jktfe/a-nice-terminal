# Windows Notes — xenoMCP

Things that will bite you if you start coding the `.pyd`-touching layer (or operating the server on Windows) without knowing them. Original brief by `@xenoCC` (Claude on the Xenomorph-issued Windows box, 2026-05-11), captured here so it survives room scrollback and onboards future contributors without a verbatim re-read.

Audience: anyone working on `xenoMCP` from a Windows host that has TimeScape installed (the production target), and anyone debugging Windows-side issues from a non-Windows dev mirror.

---

## Group A — `timescape.pyd` binding

### 1. DLL search on Python 3.8+

Python no longer consults `PATH` for extension-module DLL dependencies. `timescape.pyd` depends on native DLLs in Xenomorph TimeScape's `Program` install directory. Without registering those directories explicitly via `os.add_dll_directory(...)`, `import timescape` fails with a cryptic `DLL load failed` error.

`server.py` registers **both** Program directories on startup (32-bit AND 64-bit Program Files paths). Both must be live for the binding to import.

Overrides via env vars:

| Env | Default | Purpose |
| --- | --- | --- |
| `XENOMORPH_TIMESCAPE_PATH` | `…\APIs, SDKs, Examples\APIs\CPython\v3.13\64-Bit` | Directory containing `timescape.pyd` itself. |
| `XENOMORPH_PROGRAM_PATH` | `os.pathsep`-separated list of both `Program Files\Xenomorph TimeScape\Program` directories (Program Files + Program Files (x86)) | Dirs to register with `os.add_dll_directory()` for dependent-DLL search. |

If you only register the 64-bit Program dir and the `.pyd` happens to pull from the 32-bit one, you get the same cryptic failure. Register both.

### 2. Python version pinned to 3.13

`timescape.pyd` ships **one .pyd per supported Python version** (3.9 through 3.14, each in their own folder). Default `XENOMORPH_TIMESCAPE_PATH` points at `v3.13/64-Bit`. Mixing — e.g. running Python 3.12 against a 3.13 .pyd — breaks the import with binary-ABI errors.

Match the Python interpreter to the `.pyd` version you point at. If you want a different version, point `XENOMORPH_TIMESCAPE_PATH` at the matching folder *and* run a matching Python interpreter.

### 3. Live install reports v5.0

`t.version()` against the live TimeScape on the development host returns `5.0`. The example files inside `…\APIs, SDKs, Examples\` claim `4.0` — they're stale documentation.

**Trust the live binding, not the example files.** If you find yourself reading "v4.0" in SDK docs and confused that the running platform reports something different, this is why. Always cross-check with a live `version()` call.

### 4. Auth = Integrated Windows Auth via Kerberos / AD

The `.pyd` connects to the backing SQL Server using the **calling process's** Windows user identity. The MCP inherits the identity of whoever launched it.

**Operational consequence**: if a tool ever runs under a different user context — `LOCAL SYSTEM`, a different service account, an impersonated identity — the SQL Server connection may scope to a different tenant's data, or fail outright. The §0 Tenancy and Data Isolation rule in `docs/CONTRACT.md` depends on this identity mapping being clean and predictable. **Don't introduce code paths that swap identity mid-process.**

End-user credentials are never transmitted over the MCP wire (already in `docs/CONTRACT.md` §6). Auth flows entirely through the AD/Kerberos context bound to the server process.

---

## Group B — Server packaging

### 5. `tool.uv.package = true` is mandatory

For single-file Python projects (we have one — `server.py` lives at repo root, not in a package directory), `uv` silently **skips installing entry-point scripts** for unpackaged workspaces by default. Without `tool.uv.package = true` in `pyproject.toml`, the `xenomorph-mcp` console script never lands in the venv on `uv sync` — even though it's declared in `[project.scripts]`.

```toml
[tool.uv]
package = true
```

This is the kind of failure that's hard to spot because nothing errors — the console script just isn't there, and you get a "command not found" the first time you try to invoke it.

### 6. Hatchling build-system + `only-include = server.py`

Hatchling (our build backend) can't infer a single-file target from the project name. We have to be explicit:

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
only-include = ["server.py"]
sources = ["."]
```

Without `only-include`, hatchling looks for a package directory matching the project name (`xenomorph_mcp/`) and fails the build.

### 7. Tests pass cross-platform via the `timescape` stub

`tests/conftest.py` installs a stub `timescape` module into `sys.modules` before any test imports `server`. This lets the pure-Python surface (helpers + confirm-gating + signature checks) run on Mac/Linux where the real `.pyd` doesn't exist.

**Don't remove the stub.** If you ever need to test against the real binding, do it on the Windows host with TimeScape installed and add `@pytest.mark.requires_timescape` to those tests so they skip on dev mirrors.

---

## Group C — Admin .exe probing

### 8. Half the .exes in `Program\` are GUI — they hang on `/?`

The X*-prefix binaries in `C:\Program Files\Xenomorph TimeScape\Program\` are a mix of CLI tools and GUI applications. The GUI ones pop a dialog when invoked with `/?` and **hang waiting for user input** — they're not safe to probe from a script without a timeout.

**Confirmed CLI-shaped (safe to probe with `/?`)**:
- `TSPing64.exe`
- `XdbExport.exe`, `XdbImport.exe`
- `XListDataLoader.exe`
- `XUserConfig.exe`
- `XTTaskProcessor.exe` with a `.tdf` path argument

**Known GUI — do NOT probe with `/?`**:
- `XTWorkbench64.exe`
- `XTDriverWizard64.exe`
- `XTOfficeAdmin.exe`
- `XTTaskLauncher.exe`
- `XTTaskProcessor.exe` with no args (it pops the Workbench UI)

If you need to enumerate binaries, use `Start-Process` with a timeout (PowerShell pattern below), or check the binary's PE subsystem flag first (`Subsystem` = `WINDOWS_GUI` vs `WINDOWS_CUI`).

```powershell
Start-Process -FilePath ".\Program\XSomething.exe" -ArgumentList "/?" `
              -NoNewWindow -PassThru -Wait -Timeout 5
```

### 9. `TSCheck64.exe` needs UAC elevation

`TSCheck64.exe` requires UAC elevation. Without elevation it **silently fails** — no error message, no exit code that distinguishes it from "ran fine and found nothing wrong". If you're scripting against it, either run the whole script elevated or special-case it.

---

## Group D — Chat / wezwatch (operational, not codebase)

These notes are for the multi-agent coordination layer, not the xenoMCP product. Included because anyone developing the server on Windows will need to coordinate with the team via `antchat`.

### 10. Only `@`-mentions auto-inject

Plain (untagged) messages reach the server's SSE stream but **don't surface to wrapped Claude agents** via wezwatch's PTY-injection mechanism. Always `@`-tag the agent you want to react.

There's a known v1.1 gap parked on this — the "remote-mentions-composer" patch by EvoluteAnt Codex agents addressed the picker side; the underlying "plain messages don't reach wrapped Claudes" remains by design until that's revisited.

### 11. Pane registry at `~/.ant/wezwatch.json`

The wezwatch registry maps `@handle → WezTerm pane id`. From inside your target pane:

```bash
wezwatch bind @yourHandle
```

This reads the `WEZTERM_PANE` env var (set by WezTerm in each pane) and adds the binding. The watcher re-reads the registry on every event — no restart needed after `bind`.

Wezwatch source: `Jktfe/a-nice-terminal` repo, branch `feat/win-shim-pty-injection`, file `antchat/wezwatch.ts`. Run via:

```bash
node --experimental-strip-types --no-warnings antchat/wezwatch.ts
```

**Node 24, not Bun**. Bun on Windows fails with `ERR_SOCKET_CLOSED` in the underlying socket layer when running this script. Confirmed and parked.

---

## Bonus: `--handle` flag gotchas at `antchat join` time

Two observed silent failures when joining the room with `--handle`:

- **Handle not persisted at mint time**: if the invite was minted without the handle baked in, `--handle xyz` at join may be silently ignored — the token registers as `__nohandle__` server-side. Local CLI config can be patched to make outbound messages tag correctly, but the participants endpoint still sees the no-handle token. **Fix**: mint the invite *with the handle bound at mint time*, then `antchat join <invite> --password <pwd>` without needing `--handle`.

- **PowerShell argv splatting on unquoted `@`-prefix**: `--handle @xenoCodex` (unquoted, on PowerShell) was silently mangled by PS's splatting syntax — the server received an empty handle and fell through to `__nohandle__`. `--handle "@xenoCC"` (explicitly double-quoted) and `--handle xenoCC` (bare, no `@`) both worked. **Safe rule on PowerShell**: pass the **bare handle** (no `@`) on `--handle`, or explicit-double-quote if you need the `@`. The `@`-prefix is for *referencing* handles in chat messages and room IDs, not for CLI args.

Both behaviours fail silently with no 4xx response — the caller has to probe `/api/sessions/<room>/participants` to verify the handle registered correctly. The verification call is cheap; do it after any non-trivial join.

---

## Where to ask if you hit something not covered here

- `docs/CONTRACT.md` for the safety contract (§0 Tenancy isolation is foundational).
- `README.md` for install + run flow.
- `@xenoCC` in the XenoBridge antchat room for anything Windows-host-specific that's not in this doc.
- `@xenobridgeclaude` on the Mac mini for chassis/docs/cross-platform-test issues.
