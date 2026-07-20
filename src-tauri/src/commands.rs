use crate::menu_logic::{self, AutoEntry, MenuConfig};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use serde::Deserialize;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

static NATIVE_DIALOG_OPEN: AtomicBool = AtomicBool::new(false);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[tauri::command]
pub fn launch_app(
    app_handle: tauri::AppHandle,
    path: String,
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

    let _ = cmd.spawn();

    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.set_ignore_cursor_events(false);
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn hide_menu(app_handle: tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.set_ignore_cursor_events(false);
        let _ = window.hide();
    }
}

/// Open the parent folder in Explorer and select (highlight) the file or folder.
#[tauri::command]
pub fn reveal_in_explorer(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    let clean = path.trim().trim_matches('"').trim_matches('\'');
    if clean.is_empty() {
        return Err("Empty path".into());
    }

    let p = std::path::Path::new(clean);
    if !p.exists() {
        return Err(format!("Path not found: {clean}"));
    }

    let abs = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    // Windows canonicalize adds \\?\ — Explorer /select often fails with that prefix
    let abs_str = {
        let s = abs.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{rest}")
        } else if let Some(rest) = s.strip_prefix(r"\\?\") {
            rest.to_string()
        } else {
            s.into_owned()
        }
    };

    // explorer /select,<path> opens the containing folder with the item highlighted
    Command::new("explorer")
        .arg(format!("/select,{abs_str}"))
        .spawn()
        .map_err(|e| format!("Failed to open Explorer: {e}"))?;

    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.set_ignore_cursor_events(false);
        let _ = window.hide();
    }

    Ok(())
}

/// When the main window uses transparency, OS hit-testing still covers the full rectangle.
/// Toggle pass-through so clicks outside the pie / editor hit regions reach windows behind Hue.
#[tauri::command]
pub fn sync_main_click_through(
    app_handle: tauri::AppHandle,
    hit_disk_radius_logical: f64,
    extra_hit_rects: Option<Vec<HitRect>>,
) {
    let Some(window) = app_handle.get_webview_window("main") else {
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        let _ = window.set_ignore_cursor_events(false);
        return;
    }
    // Native file/folder dialogs must receive clicks; the always-on-top transparent
    // window would otherwise eat them outside (and sometimes over) the dialog.
    if NATIVE_DIALOG_OPEN.load(Ordering::SeqCst) {
        let _ = window.set_ignore_cursor_events(true);
        return;
    }
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    let Ok(cursor) = window.cursor_position() else {
        return;
    };
    let Ok(inner_pos) = window.inner_position() else {
        return;
    };
    let Ok(inner) = window.inner_size() else {
        return;
    };

    let cx = cursor.x - f64::from(inner_pos.x);
    let cy = cursor.y - f64::from(inner_pos.y);
    let w = inner.width as f64;
    let h = inner.height as f64;

    let outside_client = cx < 0.0 || cy < 0.0 || cx > w || cy > h;
    let center_x = w / 2.0;
    let center_y = h / 2.0;
    let dx = cx - center_x;
    let dy = cy - center_y;
    let dist = (dx * dx + dy * dy).sqrt();
    let r = hit_disk_radius_logical * scale;
    let over_pie = dist <= r;

    let over_extra = extra_hit_rects
        .as_ref()
        .map(|rects| {
            rects.iter().any(|rect| {
                let left = rect.x * scale;
                let top = rect.y * scale;
                let right = (rect.x + rect.width) * scale;
                let bottom = (rect.y + rect.height) * scale;
                cx >= left && cx <= right && cy >= top && cy <= bottom
            })
        })
        .unwrap_or(false);

    let pass_through = outside_client || !(over_pie || over_extra);
    let _ = window.set_ignore_cursor_events(pass_through);
}

/// Call around blocking OS file/folder dialogs so the always-on-top Hue window
/// does not intercept clicks meant for the dialog.
#[tauri::command]
pub fn set_native_dialog_open(app_handle: tauri::AppHandle, open: bool) {
    NATIVE_DIALOG_OPEN.store(open, Ordering::SeqCst);
    if let Some(window) = app_handle.get_webview_window("main") {
        if open {
            let _ = window.set_ignore_cursor_events(true);
            let _ = window.set_always_on_top(false);
        } else {
            let _ = window.set_always_on_top(true);
            // sync_main_click_through will restore the correct ignore flag on the next tick
        }
    }
}

#[tauri::command]
pub fn reset_main_click_through(app_handle: tauri::AppHandle) {
    NATIVE_DIALOG_OPEN.store(false, Ordering::SeqCst);
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.set_always_on_top(true);
        let _ = window.set_ignore_cursor_events(false);
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
        // Hidden webview keeps React state — force a fresh config load each open
        let _ = window.emit("preferences-reload", ());
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
pub fn list_auto_entries(folder: String, tags: Vec<String>) -> Result<Vec<AutoEntry>, String> {
    menu_logic::list_auto_entries(&folder, &tags)
}

#[tauri::command]
pub fn sync_auto_items(app_handle: tauri::AppHandle) -> MenuConfig {
    let mut config = menu_logic::load_config(&app_handle);
    if menu_logic::sync_auto_items(&mut config) {
        menu_logic::save_config(&app_handle, &config);
        if let Some(main) = app_handle.get_webview_window("main") {
            let _ = main.emit("reload-config", ());
        }
    }
    config
}

#[tauri::command]
pub fn empty_all_slices(app_handle: tauri::AppHandle) {
    let mut config = menu_logic::load_config(&app_handle);
    config.items = (0..8)
        .map(|_| menu_logic::MenuItem {
            name: String::new(),
            path: String::new(),
            children: vec![],
            auto: None,
        })
        .collect();
    menu_logic::save_config(&app_handle, &config);
    if let Some(main) = app_handle.get_webview_window("main") {
        let _ = main.emit("reload-config", ());
    }
}

fn with_native_dialog_pass_through<T>(app_handle: &tauri::AppHandle, f: impl FnOnce() -> T) -> T {
    NATIVE_DIALOG_OPEN.store(true, Ordering::SeqCst);
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.set_ignore_cursor_events(true);
        let _ = window.set_always_on_top(false);
    }
    let result = f();
    NATIVE_DIALOG_OPEN.store(false, Ordering::SeqCst);
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.set_always_on_top(true);
    }
    result
}

#[tauri::command]
pub async fn pick_file(app_handle: tauri::AppHandle) -> Option<String> {
    with_native_dialog_pass_through(&app_handle, || {
        let file = app_handle
            .dialog()
            .file()
            .add_filter("All Files", &["*"])
            .add_filter("Executables", &["exe", "bat", "cmd", "lnk", "ps1"])
            .blocking_pick_file();
        file.and_then(|f| f.as_path().map(|p| p.to_string_lossy().into_owned()))
    })
}

#[tauri::command]
pub async fn pick_folder(app_handle: tauri::AppHandle) -> Option<String> {
    with_native_dialog_pass_through(&app_handle, || {
        let folder = app_handle.dialog().file().blocking_pick_folder();
        folder.and_then(|f| f.as_path().map(|p| p.to_string_lossy().into_owned()))
    })
}

#[tauri::command]
pub fn update_shortcut(app_handle: tauri::AppHandle, new_shortcut: String) -> Result<(), String> {
    use std::sync::Mutex;
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let new_shortcut = new_shortcut.trim().to_string();
    if new_shortcut.is_empty() {
        return Err("Shortcut cannot be empty.".into());
    }

    // Clear every Hue-owned hotkey first so stale OS bindings cannot linger
    // when the in-memory string no longer matches what was registered.
    let _ = app_handle.global_shortcut().unregister_all();

    crate::register_shortcut(&app_handle, &new_shortcut)?;

    let state = app_handle.state::<Mutex<String>>();
    *state.lock().unwrap() = new_shortcut.clone();

    let mut config = menu_logic::load_config(&app_handle);
    config.global_shortcut = new_shortcut;
    menu_logic::save_config(&app_handle, &config);

    Ok(())
}
