// allowlist — M6.5 Q4 binding security lock. cmd must match enum;
// cwd must canonicalize inside HOME (no ../ escape, no absolute outside).
use std::path::{Path, PathBuf};

pub const DEFAULT_ALLOWED_CMDS: &[&str] = &[
    "bash", "zsh", "fish", "claude", "codex", "cursor", "gemini", "aider",
];

#[derive(Debug, PartialEq)]
pub enum AllowError {
    CmdNotAllowed(String),
    CwdOutsideHome(String),
    CwdInvalid(String),
}

pub fn check_cmd(cmd: &str) -> Result<(), AllowError> {
    if DEFAULT_ALLOWED_CMDS.contains(&cmd) { Ok(()) }
    else { Err(AllowError::CmdNotAllowed(cmd.to_string())) }
}

pub fn check_cwd(cwd: &str, home: &Path) -> Result<PathBuf, AllowError> {
    let path = Path::new(cwd);
    let canon = path.canonicalize().map_err(|e| AllowError::CwdInvalid(e.to_string()))?;
    let home_canon = home.canonicalize().map_err(|e| AllowError::CwdInvalid(e.to_string()))?;
    if canon.starts_with(&home_canon) { Ok(canon) }
    else { Err(AllowError::CwdOutsideHome(cwd.to_string())) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn cmd_allowlist_accepts_canonical() { assert!(check_cmd("bash").is_ok()); assert!(check_cmd("claude").is_ok()); }
    #[test] fn cmd_allowlist_rejects_unknown() { assert_eq!(check_cmd("rm").unwrap_err(), AllowError::CmdNotAllowed("rm".to_string())); }
}
