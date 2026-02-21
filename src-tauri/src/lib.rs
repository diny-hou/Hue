use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

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
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            use std::str::FromStr;
            use tauri::Emitter;
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

            let shortcut = Shortcut::from_str("alt+space").expect("failed to parse shortcut");

            let app_handle = app.handle().clone();
            let result = app
                .global_shortcut()
                .on_shortcut(shortcut, move |_app, _sc, event| {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        if event.state() == ShortcutState::Pressed {
                            let is_visible = window.is_visible().unwrap_or(false);
                            if !is_visible {
                                // Show and center menu
                                if let (Ok(pos), Ok(scale_factor)) =
                                    (window.cursor_position(), window.scale_factor())
                                {
                                    // In Tauri v2, cursor_position() returns the global physical position.
                                    // Window size is 500x500 logical pixels.
                                    // Offset to center is -250.0 logical pixels, converted to physical.
                                    let offset = 250.0 * scale_factor;

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
                            // Key Released -> Tell React to execute selection & hide
                            let _ = window.emit("hotkey-released", ());
                        }
                    }
                });

            if let Err(e) = result {
                eprintln!("Warning: could not register global shortcut: {}", e);
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_shadow(false);
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Focused(focused) => {
                if !focused {
                    let _ = window.hide();
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::launch_app,
            commands::hide_menu,
            commands::get_config,
            commands::update_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
