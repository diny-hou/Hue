use crate::menu_logic::{self, MenuConfig};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

pub const WORKSPACE_FORMAT: &str = "hue-workspace";
pub const WORKSPACE_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Clone)]
pub struct WorkspaceFile {
    pub format: String,
    pub version: u32,
    pub name: String,
    pub config: MenuConfig,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WorkspaceEntry {
    pub name: String,
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct WorkspaceRegistry {
    #[serde(default)]
    pub active_index: usize,
    #[serde(default)]
    pub entries: Vec<WorkspaceEntry>,
}

#[derive(Serialize, Clone)]
pub struct WorkspaceStatus {
    pub active_name: Option<String>,
    pub active_path: Option<String>,
    pub active_index: usize,
    pub entries: Vec<WorkspaceEntry>,
}

fn registry_path(app_handle: &AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_config_dir()
        .unwrap_or_default()
        .join("workspaces.json")
}

pub fn load_registry(app_handle: &AppHandle) -> WorkspaceRegistry {
    let path = registry_path(app_handle);
    if let Ok(content) = fs::read_to_string(&path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        WorkspaceRegistry::default()
    }
}

pub fn save_registry(app_handle: &AppHandle, registry: &WorkspaceRegistry) {
    let path = registry_path(app_handle);
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(content) = serde_json::to_string_pretty(registry) {
        let _ = fs::write(path, content);
    }
}

pub fn status_from_registry(registry: &WorkspaceRegistry) -> WorkspaceStatus {
    let entry = registry.entries.get(registry.active_index);
    WorkspaceStatus {
        active_name: entry.map(|e| e.name.clone()),
        active_path: entry.map(|e| e.path.clone()),
        active_index: registry.active_index,
        entries: registry.entries.clone(),
    }
}

fn name_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Workspace")
        .to_string()
}

/// Accept wrapped `.hue` JSON or a bare `MenuConfig` JSON.
pub fn parse_workspace_file(content: &str, fallback_name: &str) -> Result<(String, MenuConfig), String> {
    let value: serde_json::Value =
        serde_json::from_str(content).map_err(|e| format!("Invalid workspace JSON: {e}"))?;

    if value.get("format").and_then(|v| v.as_str()) == Some(WORKSPACE_FORMAT)
        || value.get("config").is_some()
    {
        let file: WorkspaceFile = serde_json::from_value(value)
            .map_err(|e| format!("Invalid Hue workspace file: {e}"))?;
        let name = if file.name.trim().is_empty() {
            fallback_name.to_string()
        } else {
            file.name
        };
        return Ok((name, file.config));
    }

    let config: MenuConfig = serde_json::from_value(value)
        .map_err(|e| format!("Invalid Hue workspace / MenuConfig JSON: {e}"))?;
    Ok((fallback_name.to_string(), config))
}

pub fn write_workspace_file(path: &Path, name: &str, config: &MenuConfig) -> Result<(), String> {
    let file = WorkspaceFile {
        format: WORKSPACE_FORMAT.to_string(),
        version: WORKSPACE_VERSION,
        name: name.to_string(),
        config: config.clone(),
    };
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

pub fn upsert_entry(registry: &mut WorkspaceRegistry, name: &str, path: &str) -> usize {
    let normalized = path.replace('/', "\\");
    if let Some(idx) = registry
        .entries
        .iter()
        .position(|e| e.path.replace('/', "\\").eq_ignore_ascii_case(&normalized))
    {
        registry.entries[idx].name = name.to_string();
        registry.entries[idx].path = path.to_string();
        registry.active_index = idx;
        return idx;
    }
    registry.entries.push(WorkspaceEntry {
        name: name.to_string(),
        path: path.to_string(),
    });
    registry.active_index = registry.entries.len() - 1;
    registry.active_index
}

pub fn apply_config(
    app_handle: &AppHandle,
    mut config: MenuConfig,
    register_hotkey: bool,
) -> Result<(), String> {
    menu_logic::normalize_parent_items(&mut config);
    if register_hotkey {
        let _ = app_handle
            .global_shortcut()
            .unregister_all();
        crate::register_shortcut(app_handle, &config.global_shortcut)?;
        if let Some(state) = app_handle.try_state::<std::sync::Mutex<String>>() {
            *state.lock().unwrap() = config.global_shortcut.clone();
        }
    }
    menu_logic::save_config(app_handle, &config);
    if let Some(main) = app_handle.get_webview_window("main") {
        let _ = main.emit("reload-config", ());
    }
    if let Some(prefs) = app_handle.get_webview_window("preferences") {
        let _ = prefs.emit("preferences-reload", ());
    }
    Ok(())
}

pub fn emit_workspace_changed(app_handle: &AppHandle, status: &WorkspaceStatus, message: &str) {
    #[derive(Serialize, Clone)]
    struct Payload {
        message: String,
        status: WorkspaceStatus,
    }
    let payload = Payload {
        message: message.to_string(),
        status: status.clone(),
    };
    if let Some(main) = app_handle.get_webview_window("main") {
        let _ = main.emit("workspace-changed", payload.clone());
    }
    if let Some(prefs) = app_handle.get_webview_window("preferences") {
        let _ = prefs.emit("workspace-changed", payload);
    }
}

pub fn save_current_to_path(
    app_handle: &AppHandle,
    path: &Path,
    name: Option<String>,
) -> Result<WorkspaceStatus, String> {
    let config = menu_logic::load_config(app_handle);
    let display_name = name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| name_from_path(path));
    write_workspace_file(path, &display_name, &config)?;
    let mut registry = load_registry(app_handle);
    upsert_entry(
        &mut registry,
        &display_name,
        &path.to_string_lossy().into_owned(),
    );
    save_registry(app_handle, &registry);
    let status = status_from_registry(&registry);
    emit_workspace_changed(
        app_handle,
        &status,
        &format!("Saved workspace “{}”", display_name),
    );
    Ok(status)
}

pub fn load_from_path(app_handle: &AppHandle, path: &Path) -> Result<WorkspaceStatus, String> {
    let content = fs::read_to_string(path).map_err(|e| format!("Failed to read workspace: {e}"))?;
    let fallback = name_from_path(path);
    let (name, config) = parse_workspace_file(&content, &fallback)?;
    apply_config(app_handle, config, true)?;
    let mut registry = load_registry(app_handle);
    upsert_entry(
        &mut registry,
        &name,
        &path.to_string_lossy().into_owned(),
    );
    save_registry(app_handle, &registry);
    let status = status_from_registry(&registry);
    emit_workspace_changed(
        app_handle,
        &status,
        &format!("Loaded workspace “{}”", name),
    );
    Ok(status)
}

pub fn cycle_workspace(app_handle: &AppHandle) -> Result<WorkspaceStatus, String> {
    let mut registry = load_registry(app_handle);
    if registry.entries.is_empty() {
        let status = status_from_registry(&registry);
        emit_workspace_changed(
            app_handle,
            &status,
            "No workspaces yet — save one in Preferences → General",
        );
        return Ok(status);
    }
    if registry.entries.len() == 1 {
        let path = PathBuf::from(&registry.entries[0].path);
        return load_from_path(app_handle, &path);
    }
    let next = (registry.active_index + 1) % registry.entries.len();
    registry.active_index = next;
    let path = PathBuf::from(&registry.entries[next].path);
    let name = registry.entries[next].name.clone();
    save_registry(app_handle, &registry);
    let content = fs::read_to_string(&path).map_err(|e| {
        format!("Workspace file missing (“{name}”): {e}. Remove it from the list or save again.")
    })?;
    let (file_name, config) = parse_workspace_file(&content, &name)?;
    apply_config(app_handle, config, true)?;
    // Keep registry name in sync with file
    if let Some(entry) = registry.entries.get_mut(next) {
        entry.name = file_name.clone();
    }
    save_registry(app_handle, &registry);
    let status = status_from_registry(&registry);
    emit_workspace_changed(
        app_handle,
        &status,
        &format!("Workspace “{}” ({}/{})", file_name, next + 1, status.entries.len()),
    );
    Ok(status)
}

pub fn remove_entry(app_handle: &AppHandle, path: &str) -> Result<WorkspaceStatus, String> {
    let mut registry = load_registry(app_handle);
    let normalized = path.replace('/', "\\");
    registry.entries.retain(|e| !e.path.replace('/', "\\").eq_ignore_ascii_case(&normalized));
    if registry.active_index >= registry.entries.len() {
        registry.active_index = registry.entries.len().saturating_sub(1);
    }
    save_registry(app_handle, &registry);
    Ok(status_from_registry(&registry))
}

pub fn switch_to_index(app_handle: &AppHandle, index: usize) -> Result<WorkspaceStatus, String> {
    let registry = load_registry(app_handle);
    let entry = registry
        .entries
        .get(index)
        .ok_or_else(|| "Workspace index out of range".to_string())?;
    load_from_path(app_handle, Path::new(&entry.path))
}
