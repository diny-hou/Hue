use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
pub struct AppearanceConfig {
    pub panel_opacity: f32,
    pub panel_color: String,
    pub text_size: f32,
    pub text_color: String,
    pub animation_type: String, // "none", "spread", "fade", "bounce"
    pub hover_scale: String,    // "none", "small", "medium", "large"
}

impl Default for AppearanceConfig {
    fn default() -> Self {
        Self {
            panel_opacity: 0.8,
            panel_color: "#333333".to_string(),
            text_size: 14.0,
            text_color: "#ffffff".to_string(),
            animation_type: "spread".to_string(),
            hover_scale: "small".to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MenuItem {
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub env: Option<std::collections::HashMap<String, String>>,
    #[serde(default)]
    pub children: Vec<MenuItem>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MenuConfig {
    #[serde(default = "default_global_shortcut")]
    pub global_shortcut: String,
    #[serde(default)]
    pub appearance: AppearanceConfig,
    pub items: Vec<MenuItem>,
}

fn default_global_shortcut() -> String {
    "alt+space".to_string()
}

impl Default for MenuConfig {
    fn default() -> Self {
        Self {
            global_shortcut: default_global_shortcut(),
            appearance: AppearanceConfig::default(),
            items: vec![
                MenuItem {
                    name: "Terminal".into(),
                    path: "wt.exe".into(),
                    env: None,
                    children: vec![
                        MenuItem {
                            name: "PowerShell".into(),
                            path: "powershell.exe".into(),
                            env: None,
                            children: vec![],
                        },
                        MenuItem {
                            name: "CMD".into(),
                            path: "cmd.exe".into(),
                            env: None,
                            children: vec![],
                        },
                        MenuItem {
                            name: "WSL".into(),
                            path: "wsl.exe".into(),
                            env: None,
                            children: vec![],
                        },
                    ],
                },
                MenuItem {
                    name: "Browser".into(),
                    path: "chrome.exe".into(),
                    env: None,
                    children: vec![],
                },
                MenuItem {
                    name: "Explorer".into(),
                    path: "explorer.exe".into(),
                    env: None,
                    children: vec![],
                },
                MenuItem {
                    name: "Notepad".into(),
                    path: "notepad.exe".into(),
                    env: None,
                    children: vec![],
                },
                MenuItem {
                    name: "Settings".into(),
                    path: "ms-settings:".into(),
                    env: None,
                    children: vec![],
                },
                MenuItem {
                    name: "TaskMgr".into(),
                    path: "taskmgr.exe".into(),
                    env: None,
                    children: vec![],
                },
                MenuItem {
                    name: "Calc".into(),
                    path: "calc.exe".into(),
                    env: None,
                    children: vec![],
                },
                MenuItem {
                    name: "Paint".into(),
                    path: "mspaint.exe".into(),
                    env: None,
                    children: vec![],
                },
            ],
        }
    }
}

pub fn get_config_path(app_handle: &AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_config_dir()
        .unwrap_or_default()
        .join("preferences.json")
}

pub fn load_config(app_handle: &AppHandle) -> MenuConfig {
    let path = get_config_path(app_handle);
    if let Ok(content) = fs::read_to_string(&path) {
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
        let _ = fs::write(&path, content);
    }
}
