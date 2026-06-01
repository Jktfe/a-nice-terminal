// configcmd — M6.5 T2d-2a: tauri::command save_desktop_config writes
// JSON to app_data_dir()/ant-desktop-config.json atomically (tempfile +
// rename). Companion writer for strongholdcfg::load_poller_config.
// Updated 2026-05-19: room_id is optional for Bearer-auth login flow.

use std::{fs, io::Write, path::PathBuf};
use serde::Serialize;
use tauri::Manager;

const CONFIG_FILENAME: &str = "ant-desktop-config.json";

#[derive(Serialize)]
struct ConfigOnDisk<'a> {
    #[serde(rename = "serverUrl")] server_url: &'a str,
    #[serde(rename = "roomId", skip_serializing_if = "str::is_empty")] room_id: &'a str,
    #[serde(rename = "bridgeToken")] bridge_token: &'a str,
}

#[tauri::command]
pub fn save_desktop_config(app: tauri::AppHandle, server_url: String, room_id: String, bridge_token: String) -> Result<(), String> {
    if server_url.is_empty() || bridge_token.is_empty() {
        return Err("serverUrl and bridgeToken must be non-empty".into());
    }
    let dir = app.path().app_data_dir().map_err(|e| format!("app_data_dir failed: {e}"))?;
    write_config_atomic(&dir, &server_url, &room_id, &bridge_token).map_err(|e| e.to_string())
}

fn write_config_atomic(dir: &PathBuf, server_url: &str, room_id: &str, bridge_token: &str) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{CONFIG_FILENAME}.tmp"));
    let json = serde_json::to_string_pretty(&ConfigOnDisk { server_url, room_id, bridge_token }).map_err(std::io::Error::other)?;
    let mut f = fs::File::create(&tmp)?;
    f.write_all(json.as_bytes())?;
    f.sync_all()?;
    drop(f);
    fs::rename(&tmp, dir.join(CONFIG_FILENAME))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::strongholdcfg::load_poller_config;

    #[test]
    fn write_then_load_roundtrip() {
        let dir = std::env::temp_dir().join("ant-desktop-cfg-write-rt");
        let _ = fs::remove_dir_all(&dir);
        write_config_atomic(&dir, "https://x:6461", "r1", "tok").unwrap();
        let cfg = load_poller_config(&dir).expect("loader returned None after write");
        assert_eq!(cfg.server_url, "https://x:6461");
        assert_eq!(cfg.room_id, "r1");
        assert_eq!(cfg.bridge_token, "tok");
    }

    #[test]
    fn write_atomic_replaces_existing() {
        let dir = std::env::temp_dir().join("ant-desktop-cfg-write-atomic");
        let _ = fs::remove_dir_all(&dir);
        write_config_atomic(&dir, "https://a", "r1", "t1").unwrap();
        write_config_atomic(&dir, "https://b", "r2", "t2").unwrap();
        let cfg = load_poller_config(&dir).unwrap();
        assert_eq!(cfg.server_url, "https://b");
        assert_eq!(cfg.room_id, "r2");
        assert_eq!(cfg.bridge_token, "t2");
    }

    #[test]
    fn allows_empty_room_id() {
        let dir = std::env::temp_dir().join("ant-desktop-cfg-empty-room");
        let _ = fs::remove_dir_all(&dir);
        write_config_atomic(&dir, "https://x", "", "tok").unwrap();
        let cfg = load_poller_config(&dir).expect("login flow must allow empty room_id");
        assert_eq!(cfg.server_url, "https://x");
        assert_eq!(cfg.room_id, "");
        assert_eq!(cfg.bridge_token, "tok");
    }
}
