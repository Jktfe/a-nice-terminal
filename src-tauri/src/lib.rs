// ANT thin-client desktop shell — m6.4 + m6.5. Tauri 2.x library entry.
// THIN-CLIENT LOCK (m6.3 Q3): no bundled server, no sidecar, no node.
// m6.4 stronghold: encrypted-at-rest URL+token via stronghold plugin.
// m6.5 PTY bridge: Rust-internal pty.rs registry; NO JS-invoke surface
// per Q4 B2 origin lock (remote-ANT webview can't trigger native spawn).
// m6.5 T2: PtyRegistry wired as managed state + polling task spawned.
// wta-12: system tray with Show/Hide/Quit menu.
// wta-13: window state persistence (size/position).
// wta-14: single-instance guard.

pub mod allowlist;
pub mod configcmd;
pub mod consent;
pub mod poller;
pub mod pty;
pub mod router_sidecar;
pub mod strongholdcfg;

use tauri::Manager;

use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let salt_path = std::env::current_exe()
        .expect("failed to resolve current_exe for stronghold salt")
        .parent()
        .expect("current_exe has no parent")
        .join("ant-stronghold-salt.txt");
    let pty_registry: Arc<pty::PtyRegistry> = pty::PtyRegistry::new();

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .manage(pty_registry.clone())
        .setup(move |app| {
            // wta-12: create system tray icon + menu
            if let Err(e) = setup_tray(app) {
                eprintln!("[ant-desktop] tray setup failed (non-fatal): {}", e);
            }

            // M6.5 T2d: try strongholdcfg::load_poller_config FIRST
            let registry = pty_registry.clone();
            let handle = app.handle().clone();
            let app_data = app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
            // E2 (2026-05-23): clone the handle once more for the router-
            // sidecar spawn so it can fire independently of the poller loop.
            // Both branches read the same PollerConfig but use it differently:
            // poller drives the message-event polling loop; router-sidecar
            // bridges room messages into a WezTerm pane via ant-router child.
            let app_handle_for_router = app.handle().clone();
            let app_data_for_router = app_data.clone();
            tauri::async_runtime::spawn(async move {
                let cfg = strongholdcfg::load_poller_config(&app_data).unwrap_or_else(|| poller::PollerConfig {
                    server_url: std::env::var("ANT_DESKTOP_SERVER_URL").unwrap_or_default(),
                    bridge_token: std::env::var("ANT_DESKTOP_BRIDGE_TOKEN").unwrap_or_default(),
                    room_id: std::env::var("ANT_DESKTOP_ROOM_ID").unwrap_or_default(),
                });
                poller::run_polling_loop(handle, registry, cfg).await;
            });
            // Fire the router-sidecar spawn after a small delay so the poller
            // claims stronghold first. Reads the same config independently.
            tauri::async_runtime::spawn(async move {
                let cfg = strongholdcfg::load_poller_config(&app_data_for_router);
                let room_id = cfg.map(|c| c.room_id).unwrap_or_default();
                // Handle is None for now — E4 will extend the config schema
                // with handle + paneTargeting fields and pass them through.
                router_sidecar::spawn_router_if_applicable(
                    &app_handle_for_router,
                    room_id,
                    None,
                );
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![configcmd::save_desktop_config]);

    // wta-14: single-instance guard (desktop only)
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let _ = show_main_window(app);
        }));
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// wta-12: tray icon setup — Show, Hide, Quit menu.
fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show_i = MenuItem::with_id(app, "show", "Show ANT", true, None::<&str>)?;
    let hide_i = MenuItem::with_id(app, "hide", "Hide ANT", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &hide_i, &quit_i])?;

    let mut tray_builder = TrayIconBuilder::new()
        .tooltip("ANT Desktop")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => { let _ = show_main_window(app); }
            "hide" => { let _ = hide_main_window(app); }
            "quit" => { app.exit(0); }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = toggle_main_window(tray.app_handle());
            }
        });

    // Use default window icon if available; otherwise build without explicit icon.
    if let Some(icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(icon);
    }

    tray_builder.build(app)?;
    Ok(())
}

fn show_main_window(app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    if let Some(window) = app.get_webview_window("main") {
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

fn hide_main_window(app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide()?;
    }
    Ok(())
}

fn toggle_main_window(app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible()? {
            window.hide()?;
        } else {
            window.show()?;
            window.set_focus()?;
        }
    }
    Ok(())
}
