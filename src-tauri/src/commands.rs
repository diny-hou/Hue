use crate::menu_logic::{self, MenuConfig};
use std::process::Command;
use tauri::{Emitter, Manager, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub fn launch_app(
    app_handle: tauri::AppHandle,
    path: String,
    env: Option<std::collections::HashMap<String, String>>,
) {
    let clean_path = path.trim().trim_matches('"').trim_matches('\'');
    let p = std::path::Path::new(clean_path);

    // Determine launch strategy based on file extension
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mut cmd = match ext.as_str() {
        "bat" | "cmd" => {
            let mut c = Command::new("cmd");
            c.args(["/C", clean_path]);
            // Hide the console window for bat/cmd scripts
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                c.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            c
        }
        "ps1" => {
            let mut c = Command::new("powershell");
            c.args(["-ExecutionPolicy", "Bypass", "-File", clean_path]);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                c.creation_flags(0x08000000);
            }
            c
        }
        _ => {
            // For .exe, .lnk, URLs, ms-settings:, etc. use explorer
            let mut c = Command::new("explorer");
            c.arg(clean_path);
            c
        }
    };

    // Set the working directory to the script/executable's parent folder
    if let Some(parent) = p.parent() {
        if parent.exists() {
            cmd.current_dir(parent);
        }
    }

    // Inject custom environment variables if provided
    if let Some(envs) = env {
        cmd.envs(envs);
    }

    let _ = cmd.spawn();

    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn hide_menu(app_handle: tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn get_config(app_handle: tauri::AppHandle) -> MenuConfig {
    menu_logic::load_config(&app_handle)
}

#[tauri::command]
pub fn update_config(app_handle: tauri::AppHandle, new_config: MenuConfig) {
    menu_logic::save_config(&app_handle, &new_config);
    if let Some(main) = app_handle.get_webview_window("main") {
        let _ = main.emit("reload-config", ());
    }
}

#[tauri::command]
pub fn open_preferences_window(app_handle: tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("preferences") {
        if let Some(main_window) = app_handle.get_webview_window("main") {
            // Position preferences to the right of the Hue circle, not overlapping
            if let Ok(main_pos) = main_window.outer_position() {
                if let Ok(main_size) = main_window.outer_size() {
                    if let Ok(pref_size) = window.outer_size() {
                        // Place at the right edge of the main window with a small gap
                        let gap = 8_i32;
                        let pref_x = main_pos.x + main_size.width as i32 / 2 + gap;
                        // Vertically center the preferences window relative to the main window
                        let pref_y =
                            main_pos.y + (main_size.height as i32 - pref_size.height as i32) / 2;
                        let _ = window.set_position(tauri::Position::Physical(
                            tauri::PhysicalPosition {
                                x: pref_x,
                                y: pref_y,
                            },
                        ));
                    }
                }
            }
            let _ = main_window.emit("preferences-opened", ());
            // Keep main window visible so user can preview design changes
            let _ = main_window.show();
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn close_preferences_window(app_handle: tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("preferences") {
        let _ = window.hide();
    }
    if let Some(main) = app_handle.get_webview_window("main") {
        let _ = main.emit("preferences-closed", ());
        let _ = main.hide(); // Hide main menu as well when done
    }
}

#[tauri::command]
pub fn empty_all_slices(app_handle: tauri::AppHandle) {
    let mut config = menu_logic::load_config(&app_handle);
    config.items = (0..8)
        .map(|_| menu_logic::MenuItem {
            name: String::new(),
            path: String::new(),
            env: None,
            children: vec![],
        })
        .collect();
    menu_logic::save_config(&app_handle, &config);
    if let Some(main) = app_handle.get_webview_window("main") {
        let _ = main.emit("reload-config", ());
    }
}

#[tauri::command]
pub async fn pick_file(app_handle: tauri::AppHandle) -> Option<String> {
    // Try file picker first (allows any file type)
    let file = app_handle
        .dialog()
        .file()
        .add_filter("All Files", &["*"])
        .add_filter("Executables", &["exe", "bat", "cmd", "lnk", "ps1"])
        .blocking_pick_file();
    file.and_then(|f| f.as_path().map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn pick_files(app_handle: tauri::AppHandle) -> Vec<String> {
    let files = app_handle
        .dialog()
        .file()
        .add_filter("All Files", &["*"])
        .add_filter("Executables", &["exe", "bat", "cmd", "lnk", "ps1"])
        .blocking_pick_files();

    match files {
        Some(file_paths) => file_paths
            .into_iter()
            .filter_map(|fp| fp.as_path().map(|p| p.to_string_lossy().into_owned()))
            .collect(),
        None => vec![],
    }
}

#[tauri::command]
pub async fn pick_folder(app_handle: tauri::AppHandle) -> Option<String> {
    let folder = app_handle.dialog().file().blocking_pick_folder();
    folder.and_then(|f| f.as_path().map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn update_shortcut(app_handle: tauri::AppHandle, new_shortcut: String) -> Result<(), String> {
    use std::str::FromStr;
    use std::sync::Mutex;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

    // 1. Get current shortcut string from state
    let state = app_handle.state::<Mutex<String>>();
    let current_shortcut_str = state.lock().unwrap().clone();

    // 2. Unregister old shortcut
    if let Ok(old_shortcut) = Shortcut::from_str(&current_shortcut_str) {
        let _ = app_handle.global_shortcut().unregister(old_shortcut);
    }

    // 3. Register new shortcut
    crate::register_shortcut(&app_handle, &new_shortcut);

    // 4. Update the state with the new shortcut
    *state.lock().unwrap() = new_shortcut.clone();

    // 5. Save the configuration to disk
    let mut config = menu_logic::load_config(&app_handle);
    config.global_shortcut = new_shortcut;
    menu_logic::save_config(&app_handle, &config);

    Ok(())
}
