# wta-07 install-test runbook — Win10 + Win11

Companion to `scripts/audit-windows-tauri-smoke.sh.template`. When
@antchatdev (or whoever has VM access) is ready to execute wta-07,
follow this script — every step has the expected output documented so
deviations get caught immediately.

Owner: @evolveantux (runbook author) + @antchatdev (executor).
Status: ready-to-execute; gated only on someone having Win VMs at hand.

## Prerequisites

- Fresh Win10 VM (build 19041+ for WebView2 auto-install)
- Fresh Win11 VM (build 22000+ for native WebView2)
- Both VMs need internet access (for scoop bucket fetch)
- Optional: Wireshark or built-in Resource Monitor to capture network
  during smoke (not required for PASS/FAIL but nice for evidence)

## Phase 1: Prep both VMs (one-time)

```powershell
# Install scoop if not already present
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression

# Verify scoop works
scoop --version
# Expected: Current Scoop version: vX.Y.Z (commit ...)

# Add the ANT bucket (assuming https://github.com/Jktfe/scoop-ant published)
scoop bucket add ant https://github.com/Jktfe/scoop-ant
# Expected: The ant bucket was added successfully.
```

Capture: screenshot of scoop --version + `scoop bucket list` output
showing `ant` row.

## Phase 2: C1 cold install (per VM)

```powershell
scoop install antchat-tauri
```

Expected:
- Download progress for the antchat-tauri MSI/zip
- "Installing 'antchat-tauri' (X.Y.Z) [64bit] from ant bucket"
- "'antchat-tauri' (X.Y.Z) was installed successfully!"
- New Start Menu entry "ANT antchat" appears

Capture: copy the install output + Start Menu screenshot.

Pass criteria: exit code 0 + Start Menu entry exists + clicking it
launches the app.

## Phase 3: C2 first-paint (per VM)

```powershell
# Launch from Start Menu OR command line
scoop info antchat-tauri | Select-String "Path"
# (Path will be something like ~/scoop/apps/antchat-tauri/current/antchat-tauri.exe)
& "<that path>"
```

Time from process spawn to window-visible should be ≤3 seconds. Use
the wall clock or Task Manager process-tree timing.

Expected: window appears showing F8 BearerAuthFlow login screen
(docs/tauri-templates/F8-BearerAuthFlow.svelte shape — email +
password form).

Capture: screenshot of login screen.

Pass criteria: window visible ≤3s + login screen renders correctly.

## Phase 4: Bearer auth round-trip (per VM)

Enter test credentials:
- Email: `test@antchat.local` (or your provisioned test account)
- Password: `<test-account-password>`

Expected:
- "Signing in…" pill appears briefly
- State transitions to `authed`
- Rooms list visible (14 rooms if pointed at the dev :6174 server)

Capture: screenshot of authed state with rooms list.

Pass criteria: round-trip completes within 5s + rooms visible.

## Phase 5: C3 restart resilience (per VM)

```powershell
# Note current size of the store file
$store = "$env:APPDATA\com.ant.fresh\.ant-auth.json"
Get-Item $store | Select-Object Length, LastWriteTime

# Kill the app
Stop-Process -Name "antchat-tauri" -Force

# Relaunch
& "<scoop path>\antchat-tauri.exe"

# Verify store unchanged
Get-Item $store | Select-Object Length, LastWriteTime
```

Expected:
- Store file Length + LastWriteTime unchanged across kill/relaunch
- App opens directly to rooms list (NOT login screen)

Capture: screenshot showing rooms list on first paint after relaunch.

Pass criteria: no relogin required + store file unchanged.

## Phase 6: C4 uninstall clean (per VM)

```powershell
scoop uninstall antchat-tauri
scoop list antchat-tauri
```

Expected from list: `Nothing found.`

Then check for orphan files:

```powershell
Test-Path "$env:APPDATA\com.ant.fresh"
# Expected: True (store directory preserved — re-install picks up old session)
# OR False (full clean — re-install starts from login)
# Either is acceptable; document which behaviour scoop produces.
```

Capture: scoop list output + APPDATA check.

Pass criteria: scoop list shows "Nothing found" + Start Menu entry
gone.

## Phase 7: Edge cases (optional but ideal)

7a. **Server-down during launch**: launch antchat-tauri with the
    server unreachable. Expected: F8 BearerAuthFlow shows
    `server-down` state with offline banner, NOT a hard error.

7b. **Token expiry (401)**: somehow expire the token (delete on
    server side via admin route, or wait 24h). Launch app. Expected:
    transitions to `idle` (login screen) cleanly, no crash.

7c. **Network flap mid-session**: cause WiFi drop during chat. Expected:
    UI degrades gracefully; reconnect attempts resume on flap-back.

## Reporting

Post results to `windows/Tauri antchat app` (ms25g8vtlh) using this
shape:

```
wta-07 Win10 smoke: C1 PASS · C2 PASS (1.8s) · C3 PASS · C4 PASS · 7a PASS · 7b SKIP · 7c PASS
wta-07 Win11 smoke: C1 PASS · C2 PASS (1.4s) · C3 PASS · C4 PASS · 7a PASS · 7b SKIP · 7c PASS
```

Plus the 5 screenshots from phases 2-6. If any phase fails, file an
issue under `Jktfe/antchat-windows` with the screenshot + the relevant
log lines from Win11 Event Viewer + the antchat-tauri stderr.

## When this runbook can be retired

When wta-07 reports back GREEN on both Win10 + Win11, mark wta-07
done in the windows-tauri plan + this runbook becomes the
periodic-regression doc (re-run on every Tauri release).
