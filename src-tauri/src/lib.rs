use tauri::Manager;

mod commands;
mod menu_logic;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Updater: endpoints and pubkey in tauri.conf.json. Local HTTP: merge tauri.updater-local.json
        // (`npm run tauri:build:local-updater`).
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {
            // A second instance was started - it will exit automatically.
            // We could also focus the existing window here if desired.
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            use std::sync::Mutex;

            let config = menu_logic::load_config(&app.handle());
            let app_handle = app.handle().clone();

            // Store the current shortcut string in state so it can be updated
            app.manage(Mutex::new(config.global_shortcut.clone()));

            if let Err(e) = register_shortcut(&app_handle, &config.global_shortcut) {
                eprintln!("Warning: {e}");
            }

            // Check if started with --minimized (autostart)
            let args: Vec<String> = std::env::args().collect();
            let is_minimized = args.contains(&"--minimized".to_string());

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_shadow(false);
                // Hide window on startup if minimized flag is set (autostart)
                if is_minimized {
                    let _ = window.hide();
                }
            }

            use tauri::{
                menu::{Menu, MenuItem},
                tray::TrayIconBuilder,
            };

            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let pref_i = MenuItem::with_id(app, "preferences", "Preferences", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&pref_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app: &tauri::AppHandle, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "preferences" => {
                        let _ = commands::open_preferences_window(app.clone());
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::launch_app,
            commands::hide_menu,
            commands::sync_main_click_through,
            commands::reset_main_click_through,
            commands::set_native_dialog_open,
            commands::get_config,
            commands::update_config,
            commands::pick_file,
            commands::pick_folder,
            commands::update_shortcut,
            commands::open_preferences_window,
            commands::close_preferences_window,
            commands::empty_all_slices,
            commands::list_auto_entries,
            commands::sync_auto_items
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub fn register_shortcut(app_handle: &tauri::AppHandle, shortcut_str: &str) -> Result<(), String> {
    use std::str::FromStr;
    use tauri::Emitter;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

    let shortcut = Shortcut::from_str(shortcut_str)
        .map_err(|e| format!("Invalid shortcut “{shortcut_str}”: {e}"))?;

    let handle_clone = app_handle.clone();
    app_handle
        .global_shortcut()
        .on_shortcut(shortcut, move |_app, _sc, event| {
            if let Some(window) = handle_clone.get_webview_window("main") {
                if event.state() == ShortcutState::Pressed {
                    let is_visible = window.is_visible().unwrap_or(false);
                    if !is_visible {
                        if let (Ok(pos), Ok(scale_factor)) =
                            (window.cursor_position(), window.scale_factor())
                        {
                            let offset = 500.0 * scale_factor;
                            let new_pos = tauri::PhysicalPosition {
                                x: (pos.x - offset) as i32,
                                y: (pos.y - offset) as i32,
                            };
                            let _ = window.set_position(tauri::Position::Physical(new_pos));
                        }
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.emit("menu-show", ());
                    }
                } else if event.state() == ShortcutState::Released {
                    let _ = window.emit("menu-hide", ());
                }
            }
        })
        .map_err(|e| format!("Could not register shortcut “{shortcut_str}”: {e}"))
}
