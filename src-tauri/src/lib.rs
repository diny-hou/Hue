use tauri::Manager;

mod commands;
mod menu_logic;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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

            register_shortcut(&app_handle, &config.global_shortcut);

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_shadow(false);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::launch_app,
            commands::hide_menu,
            commands::get_config,
            commands::update_config,
            commands::pick_file,
            commands::pick_files,
            commands::pick_folder,
            commands::update_shortcut,
            commands::open_preferences_window,
            commands::close_preferences_window,
            commands::empty_all_slices
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub fn register_shortcut(app_handle: &tauri::AppHandle, shortcut_str: &str) {
    use std::str::FromStr;
    use tauri::Emitter;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

    let shortcut = match Shortcut::from_str(shortcut_str) {
        Ok(s) => s,
        Err(_) => {
            eprintln!("Warning: failed to parse shortcut: {}", shortcut_str);
            return;
        }
    };

    let handle_clone = app_handle.clone();
    let result = app_handle
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
                        let _ = window.emit("menu-show", ());
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                } else if event.state() == ShortcutState::Released {
                    let _ = window.emit("menu-hide", ());
                }
            }
        });

    if let Err(e) = result {
        eprintln!("Warning: could not register global shortcut: {}", e);
    }
}
