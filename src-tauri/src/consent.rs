// consent — M6.5 T2b operator consent prompt wrapper. Wraps PtyRegistry::spawn
// with a tauri-plugin-dialog blocking confirmation modal so every PTY spawn
// requires explicit operator click. Per Q4 lock: even local origins need a
// visible go-ahead before native command execution.
use std::path::Path;
use std::sync::Arc;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use crate::pty::{HandleId, PtyRegistry, SpawnError};

/// Prompts the operator with a dialog modal showing cmd + args; on Yes,
/// delegates to PtyRegistry::spawn; on No, returns ConsentDenied error.
pub fn spawn_with_consent(
    app: &AppHandle,
    registry: &Arc<PtyRegistry>,
    cwd: &str,
    cmd: &str,
    args: Vec<String>,
    home: &Path,
) -> Result<HandleId, ConsentSpawnError> {
    let prompt = format!(
        "ANT wants to spawn a local terminal session.\n\nCommand: {} {}\nWorking dir: {}\n\nApprove?",
        cmd, args.join(" "), cwd
    );
    let confirmed = app.dialog()
        .message(prompt)
        .title("ANT — Confirm PTY Spawn")
        .buttons(MessageDialogButtons::OkCancel)
        .blocking_show();
    if !confirmed { return Err(ConsentSpawnError::Denied); }
    registry.spawn(cwd, cmd, args, home).map_err(ConsentSpawnError::Spawn)
}

#[derive(Debug)]
pub enum ConsentSpawnError {
    Denied,
    Spawn(SpawnError),
}
