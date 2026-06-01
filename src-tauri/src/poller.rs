// poller — M6.5 T2 Rust polling task. Periodically GETs chat-room
// messages from the configured remote ANT server URL + dispatches any
// terminal_input messages addressed to local PTY handles to the
// PtyRegistry. NO new ANT API surface — pure consumer of existing
// /api/chat-rooms/:roomId/messages route. Token + server URL loaded
// from stronghold (m6.4 Slice 2). Lives under tauri::async_runtime::spawn.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use crate::consent::spawn_with_consent;
use crate::pty::{HandleId, PtyRegistry};

const POLL_CADENCE_MS: u64 = 2_000;

#[derive(Debug)]
pub struct PollerConfig {
    pub server_url: String,
    pub bridge_token: String,
    pub room_id: String,
}

#[derive(Debug, serde::Deserialize)]
struct MessagesEnvelope {
    messages: Vec<RoomMessage>,
}
#[derive(Debug, serde::Deserialize)]
struct RoomMessage {
    body: String,
    #[serde(rename = "authorHandle", default)]
    author_handle: Option<String>,
    #[serde(rename = "kind", default)]
    kind: Option<String>,
}

// Parse a `terminal_input <handle-id>: <bytes>` message body. Returns
// (handle_id, bytes) on match. Real-world spec lives in PTY-INJECT-A
// design doc (a-nice-terminal repo); here we accept the simplest shape.
pub fn parse_terminal_input(body: &str) -> Option<(HandleId, Vec<u8>)> {
    let stripped = body.strip_prefix("terminal_input ")?;
    let (id_str, payload) = stripped.split_once(':')?;
    let id: HandleId = id_str.trim().parse().ok()?;
    Some((id, payload.trim_start().as_bytes().to_vec()))
}

/// T2c parser: detect `pty_spawn cmd: <cmd> args: <args> cwd: <cwd>` shape.
/// Returns parsed SpawnRequest on match. Args is comma-separated for v1.
#[derive(Debug, PartialEq)]
pub struct SpawnRequest {
    pub cmd: String,
    pub args: Vec<String>,
    pub cwd: String,
}
pub fn parse_spawn_request(body: &str) -> Option<SpawnRequest> {
    let stripped = body.strip_prefix("pty_spawn ")?;
    let cmd_part = stripped.strip_prefix("cmd: ")?;
    let (cmd, rest) = cmd_part.split_once(" args: ")?;
    let (args_str, cwd) = rest.split_once(" cwd: ")?;
    let args: Vec<String> = if args_str.is_empty() { vec![] }
        else { args_str.split(',').map(|s| s.trim().to_string()).collect() };
    Some(SpawnRequest { cmd: cmd.trim().to_string(), args, cwd: cwd.trim().to_string() })
}

pub async fn run_polling_loop(app: AppHandle, registry: Arc<PtyRegistry>, cfg: PollerConfig) {
    if cfg.room_id.is_empty() {
        // Bearer-auth login flow: no room configured yet.
        // Poller idle until user joins a room via webview.
        return;
    }
    let url = format!(
        "{}/api/chat-rooms/{}/messages",
        cfg.server_url.trim_end_matches('/'),
        cfg.room_id
    );
    let home = std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("/"));
    loop {
        if let Some(envelope) = fetch_messages(&url, &cfg.bridge_token).await {
            for msg in envelope.messages {
                if msg.kind.as_deref() == Some("system-break") { continue; }
                // Dispatch by message body shape. spawn_request needs operator
                // consent; terminal_input is byte-stream into an existing PTY.
                if let Some(req) = parse_spawn_request(&msg.body) {
                    let _ = spawn_with_consent(&app, &registry, &req.cwd, &req.cmd, req.args, &home);
                } else if let Some((id, bytes)) = parse_terminal_input(&msg.body) {
                    let _ = registry.write(id, &bytes);
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(POLL_CADENCE_MS)).await;
    }
}

async fn fetch_messages(url: &str, token: &str) -> Option<MessagesEnvelope> {
    // T2b: real reqwest fetch with bearer auth + 5s timeout. Transient
    // failures (network errors, non-2xx) return None so the polling loop
    // tolerates flaky connectivity without dying.
    if url.is_empty() || token.is_empty() { return None; }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build().ok()?;
    let res = client.get(url)
        .bearer_auth(token)
        .send().await.ok()?;
    if !res.status().is_success() { return None; }
    res.json::<MessagesEnvelope>().await.ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parse_terminal_input_happy() {
        let parsed = parse_terminal_input("terminal_input 42: ls -la\n");
        assert_eq!(parsed, Some((42, b"ls -la\n".to_vec())));
    }
    #[test]
    fn parse_terminal_input_missing_prefix_rejected() {
        assert!(parse_terminal_input("hello world").is_none());
    }
    #[test]
    fn parse_terminal_input_bad_id_rejected() {
        assert!(parse_terminal_input("terminal_input abc: cmd").is_none());
    }
    #[test]
    fn parse_terminal_input_no_colon_rejected() {
        assert!(parse_terminal_input("terminal_input 42 cmd").is_none());
    }
    #[test]
    fn parse_spawn_request_happy() {
        let req = parse_spawn_request("pty_spawn cmd: claude args: --version cwd: /Users/x/repo");
        assert_eq!(req, Some(SpawnRequest {
            cmd: "claude".into(),
            args: vec!["--version".into()],
            cwd: "/Users/x/repo".into(),
        }));
    }
    #[test]
    fn parse_spawn_request_empty_args_ok() {
        let req = parse_spawn_request("pty_spawn cmd: zsh args:  cwd: /home/me");
        assert_eq!(req, Some(SpawnRequest { cmd: "zsh".into(), args: vec![], cwd: "/home/me".into() }));
    }
    #[test]
    fn parse_spawn_request_missing_prefix_rejected() {
        assert!(parse_spawn_request("hello world").is_none());
        assert!(parse_spawn_request("pty_spawn no_keyword").is_none());
    }
    #[test]
    fn parse_spawn_request_comma_separated_args() {
        let req = parse_spawn_request("pty_spawn cmd: codex args: -p, prompt cwd: /tmp");
        assert_eq!(req.unwrap().args, vec!["-p", "prompt"]);
    }
}
