use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct MenuItem {
    pub name: String,
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MenuConfig {
    pub items: Vec<MenuItem>,
}

impl Default for MenuConfig {
    fn default() -> Self {
        Self {
            items: vec![
                MenuItem { name: "Terminal".into(), path: "wt.exe".into() },
                MenuItem { name: "Browser".into(), path: "chrome.exe".into() },
                MenuItem { name: "Explorer".into(), path: "explorer.exe".into() },
                MenuItem { name: "Notepad".into(), path: "notepad.exe".into() },
                MenuItem { name: "Settings".into(), path: "ms-settings:".into() },
                MenuItem { name: "TaskMgr".into(), path: "taskmgr.exe".into() },
                MenuItem { name: "Calc".into(), path: "calc.exe".into() },
                MenuItem { name: "Paint".into(), path: "mspaint.exe".into() },
            ],
        }
    }
}

pub fn get_config_path(app_handle: &AppHandle) -> PathBuf {
    app_handle.path().app_config_dir().unwrap_or_default().join("menu.json")
}

pub fn load_config(app_handle: &AppHandle) -> MenuConfig {
    let path = get_config_path(app_handle);
    if let Ok(content) = fs::read_to_string(path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        MenuConfig::default()
    }
}

pub fn save_config(app_handle: &AppHandle, config: &MenuConfig) {
    let path = get_config_path(app_handle);
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(content) = serde_json::to_string_pretty(config) {
        let _ = fs::write(path, content);
    }
}
