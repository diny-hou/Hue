use tauri::{Manager, Emitter};
use std::process::Command;
use crate::menu_logic::{self, MenuConfig, MenuItem};
use tauri_plugin_dialog::DialogExt;
use serde_json::json;

#[tauri::command]
pub fn launch_app(app_handle: tauri::AppHandle, path: String) {
    let _ = Command::new(&path).spawn();
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
pub async fn pick_file(app_handle: tauri::AppHandle) -> Option<String> {
    let file = app_handle
        .dialog()
        .file()
        .add_filter("Executable", &["exe", "bat", "cmd", "lnk"])
        .blocking_pick_file();
    file.and_then(|f| f.as_path().map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn open_editor(
    app_handle: tauri::AppHandle,
    index: usize,
    item: MenuItem,
    client_x: f64,
    client_y: f64,
) {
    if let (Some(main), Some(editor)) = (
        app_handle.get_webview_window("main"),
        app_handle.get_webview_window("editor"),
    ) {
        if let (Ok(main_pos), Ok(scale_factor)) = (main.outer_position(), main.scale_factor()) {
            let offset_x = client_x * scale_factor;
            let offset_y = client_y * scale_factor;
            let new_pos = tauri::PhysicalPosition {
                x: main_pos.x + offset_x as i32,
                y: main_pos.y + offset_y as i32,
            };

            let _ = editor.set_position(tauri::Position::Physical(new_pos));
            let payload = json!({ "index": index, "item": item });
            let _ = editor.emit("load-item", payload);
            let _ = editor.show();
            let _ = editor.set_focus();
        }
    }
}

#[tauri::command]
pub fn close_editor(app_handle: tauri::AppHandle) {
    if let Some(editor) = app_handle.get_webview_window("editor") {
        let _ = editor.hide();
    }
}
