// E2 (windows-app router bundling 2026-05-23): spawn the Tauri 2.x
// shell-plugin sidecar `ant-router` from setup-hook. The router script
// (scripts/ant-cli-pane-router-win.mjs) is pre-compiled to a single
// binary by E1's `bun build --compile` recipe and lives at
// src-tauri/binaries/ant-router-<target-triple>[.exe]; Tauri 2.x
// resolves the right variant from tauri.conf.json's externalBin entry.
//
// Lifecycle: child is managed by the shell plugin — auto-killed when
// the Tauri app exits. No auto-respawn yet; if the router dies the
// user restarts Tauri. Auto-respawn is 0.1.9 polish (E2.next).
//
// Platform gating: Windows-only for now. Mac antchat uses Bun.Terminal
// pty injection directly (no router needed); Linux is unverified.
// The platform branch sits at function-entry so cross-compile builds
// on Mac/Linux are clean (no dead-code warnings, no plugin-feature-
// missing surprises).

use tauri::AppHandle;
#[cfg(target_os = "windows")]
use tauri_plugin_shell::process::CommandEvent;
#[cfg(target_os = "windows")]
use tauri_plugin_shell::ShellExt;

pub fn spawn_router_if_applicable(app: &AppHandle, room_id: String, handle: Option<String>) {
    #[cfg(not(target_os = "windows"))]
    {
        // Suppress unused-arg warnings on non-windows builds without changing the
        // signature (caller code stays platform-agnostic).
        let _ = (app, room_id, handle);
        return;
    }

    #[cfg(target_os = "windows")]
    {
        spawn_router_windows(app, room_id, handle);
    }
}

#[cfg(target_os = "windows")]
fn spawn_router_windows(app: &AppHandle, room_id: String, handle: Option<String>) {
    if room_id.is_empty() {
        eprintln!("[ant-router] room_id empty — skipping router spawn (headless desktop mode).");
        return;
    }

    // Transitional until E4 lands the config-schema extension: pull handle
    // from the optional arg first (caller may have a Tauri-stored value),
    // then ANT_HANDLE env, then fall through to @you. The router's CLI
    // parser tolerates @-or-no-@ prefix.
    let resolved_handle = handle
        .filter(|h| !h.is_empty())
        .or_else(|| std::env::var("ANT_HANDLE").ok())
        .unwrap_or_else(|| "@you".to_string());

    let args: Vec<&str> = vec![
        "--room",
        &room_id,
        "--handle",
        &resolved_handle,
    ];

    let sidecar_command = match app.shell().sidecar("ant-router") {
        Ok(cmd) => cmd.args(&args),
        Err(err) => {
            eprintln!("[ant-router] sidecar lookup failed: {}", err);
            return;
        }
    };

    let (mut rx, _child) = match sidecar_command.spawn() {
        Ok(result) => result,
        Err(err) => {
            eprintln!("[ant-router] sidecar spawn failed: {}", err);
            return;
        }
    };

    eprintln!(
        "[ant-router] sidecar started: room={} handle={}",
        room_id, resolved_handle
    );

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    eprintln!("[ant-router][stdout] {}", line.trim_end());
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    eprintln!("[ant-router][stderr] {}", line.trim_end());
                }
                CommandEvent::Error(err) => {
                    eprintln!("[ant-router][error] {}", err);
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!(
                        "[ant-router][terminated] code={:?} signal={:?}",
                        payload.code, payload.signal
                    );
                    break;
                }
                _ => {}
            }
        }
    });
}
