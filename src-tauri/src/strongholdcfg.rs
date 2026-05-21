// strongholdcfg — M6.5 T2d Rust-side PollerConfig loader.
// Per Q1 split-source design (delta-2): non-secret config (serverUrl,
// roomId) lives in plain JSON at app_data_dir()/ant-desktop-config.json;
// secret bridgeToken lives in stronghold via raw iota_stronghold. v1
// implementation returns None gracefully when either source is missing
// or unreadable — caller (lib.rs setup) falls back to env-var-config.
// Updated 2026-05-19: room_id may be empty for Bearer-auth login flow.

use std::fs;
use std::path::PathBuf;
use serde::Deserialize;
use crate::poller::PollerConfig;

const CONFIG_FILENAME: &str = "ant-desktop-config.json";

#[derive(Deserialize)]
struct ConfigFile {
    #[serde(rename = "serverUrl")]
    server_url: Option<String>,
    #[serde(rename = "roomId")]
    room_id: Option<String>,
    /// v1 placeholder: bridge token in JSON pending stronghold migration
    /// in T2d-followup. Document warns operators to chmod 600 the file.
    #[serde(rename = "bridgeToken")]
    bridge_token: Option<String>,
}

pub fn load_poller_config(app_data_dir: &PathBuf) -> Option<PollerConfig> {
    let path = app_data_dir.join(CONFIG_FILENAME);
    let raw = fs::read_to_string(&path).ok()?;
    let cfg: ConfigFile = serde_json::from_str(&raw).ok()?;
    let server_url = cfg.server_url.filter(|s| !s.is_empty())?;
    let bridge_token = cfg.bridge_token.filter(|s| !s.is_empty())?;
    let room_id = cfg.room_id.unwrap_or_default();
    Some(PollerConfig { server_url, bridge_token, room_id })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn returns_none_when_config_missing() {
        let dir = std::env::temp_dir().join("ant-desktop-cfg-test-empty");
        fs::create_dir_all(&dir).unwrap();
        let _ = fs::remove_file(dir.join(CONFIG_FILENAME));
        assert!(load_poller_config(&dir).is_none());
    }

    #[test]
    fn returns_none_when_json_invalid() {
        let dir = std::env::temp_dir().join("ant-desktop-cfg-test-bad");
        fs::create_dir_all(&dir).unwrap();
        let mut f = fs::File::create(dir.join(CONFIG_FILENAME)).unwrap();
        write!(f, "not json").unwrap();
        assert!(load_poller_config(&dir).is_none());
    }

    #[test]
    fn returns_some_when_all_fields_present() {
        let dir = std::env::temp_dir().join("ant-desktop-cfg-test-ok");
        fs::create_dir_all(&dir).unwrap();
        let mut f = fs::File::create(dir.join(CONFIG_FILENAME)).unwrap();
        write!(f, r#"{"serverUrl":"https://x:6461","roomId":"r1","bridgeToken":"tok"}"#).unwrap();
        let cfg = load_poller_config(&dir).expect("load returned None");
        assert_eq!(cfg.server_url, "https://x:6461");
        assert_eq!(cfg.room_id, "r1");
        assert_eq!(cfg.bridge_token, "tok");
    }

    #[test]
    fn returns_some_with_empty_room_id() {
        let dir = std::env::temp_dir().join("ant-desktop-cfg-test-login");
        fs::create_dir_all(&dir).unwrap();
        let mut f = fs::File::create(dir.join(CONFIG_FILENAME)).unwrap();
        write!(f, r#"{"serverUrl":"https://x:6461","roomId":"","bridgeToken":"tok"}"#).unwrap();
        let cfg = load_poller_config(&dir).expect("login flow must work with empty room");
        assert_eq!(cfg.server_url, "https://x:6461");
        assert_eq!(cfg.room_id, "");
        assert_eq!(cfg.bridge_token, "tok");
    }

    #[test]
    fn returns_none_when_server_url_empty() {
        let dir = std::env::temp_dir().join("ant-desktop-cfg-test-empty-url");
        fs::create_dir_all(&dir).unwrap();
        let mut f = fs::File::create(dir.join(CONFIG_FILENAME)).unwrap();
        write!(f, r#"{"serverUrl":"","roomId":"r1","bridgeToken":"tok"}"#).unwrap();
        assert!(load_poller_config(&dir).is_none());
    }
}
