// pty — M6.5 local-terminal-bridge implementation. Internal-only Rust API
// per design Q2 lock: NO Tauri-invoke surface exposed to the remote-ANT
// webview (B2 origin gating). PTY lifecycle managed by an in-process
// HashMap<HandleId, PtyEntry> behind a Mutex; orchestration runs in a
// Rust polling task (Q5) that POSTs stdout to the chat-room messages
// route + receives terminal_input from there.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;

use crate::allowlist::{check_cmd, check_cwd, AllowError};

pub type HandleId = u64;

pub struct PtyEntry {
    pub master: Box<dyn MasterPty + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub cmd: String,
    pub cwd: PathBuf,
}

#[derive(Default)]
pub struct PtyRegistry {
    inner: Mutex<HashMap<HandleId, PtyEntry>>,
    next_id: Mutex<HandleId>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PtyHandleInfo {
    pub id: HandleId,
    pub cmd: String,
    pub cwd: String,
}

#[derive(Debug)]
pub enum SpawnError {
    Allow(AllowError),
    Spawn(String),
}

impl From<AllowError> for SpawnError {
    fn from(e: AllowError) -> Self { SpawnError::Allow(e) }
}

impl PtyRegistry {
    pub fn new() -> Arc<Self> { Arc::new(Self::default()) }

    fn next_handle(&self) -> HandleId {
        let mut g = self.next_id.lock().expect("PtyRegistry next_id poisoned");
        *g += 1;
        *g
    }

    pub fn spawn(&self, cwd: &str, cmd: &str, args: Vec<String>, home: &std::path::Path)
        -> Result<HandleId, SpawnError>
    {
        check_cmd(cmd)?;
        let canon_cwd = check_cwd(cwd, home)?;
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| SpawnError::Spawn(e.to_string()))?;
        let mut builder = CommandBuilder::new(cmd);
        builder.args(args.iter().map(|s| s.as_str()));
        builder.cwd(&canon_cwd);
        let child = pair.slave.spawn_command(builder)
            .map_err(|e| SpawnError::Spawn(e.to_string()))?;
        let id = self.next_handle();
        let entry = PtyEntry { master: pair.master, child, cmd: cmd.to_string(), cwd: canon_cwd };
        self.inner.lock().expect("PtyRegistry inner poisoned").insert(id, entry);
        Ok(id)
    }

    pub fn write(&self, id: HandleId, data: &[u8]) -> Result<(), String> {
        let mut g = self.inner.lock().map_err(|e| e.to_string())?;
        let entry = g.get_mut(&id).ok_or_else(|| format!("unknown handle {id}"))?;
        let mut writer = entry.master.take_writer().map_err(|e| e.to_string())?;
        std::io::Write::write_all(&mut writer, data).map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: HandleId, cols: u16, rows: u16) -> Result<(), String> {
        let g = self.inner.lock().map_err(|e| e.to_string())?;
        let entry = g.get(&id).ok_or_else(|| format!("unknown handle {id}"))?;
        entry.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())
    }

    pub fn kill(&self, id: HandleId) -> Result<(), String> {
        let mut g = self.inner.lock().map_err(|e| e.to_string())?;
        let mut entry = g.remove(&id).ok_or_else(|| format!("unknown handle {id}"))?;
        entry.child.kill().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list(&self) -> Vec<PtyHandleInfo> {
        let g = self.inner.lock().expect("PtyRegistry inner poisoned");
        g.iter().map(|(id, e)| PtyHandleInfo {
            id: *id, cmd: e.cmd.clone(),
            cwd: e.cwd.to_string_lossy().to_string(),
        }).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn spawn_unknown_cmd_rejected_by_allowlist() {
        let reg = PtyRegistry::new();
        let home = std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("/tmp"));
        let err = reg.spawn("/tmp", "rm", vec!["-rf".into(), "/".into()], &home).err();
        assert!(matches!(err, Some(SpawnError::Allow(AllowError::CmdNotAllowed(_)))));
    }
    #[test]
    fn list_starts_empty() {
        let reg = PtyRegistry::new();
        assert!(reg.list().is_empty());
    }
}
