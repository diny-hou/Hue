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
    #[serde(default = "default_hover_animation")]
    pub hover_animation: String, // "none", "jiggle", "pulse", "glow"
    #[serde(default = "default_hover_opacity")]
    pub hover_opacity: f32,
    #[serde(default = "default_sub_panel_opacity")]
    pub sub_panel_opacity: f32,
    #[serde(default = "default_drag_opacity")]
    pub drag_opacity: f32,
    #[serde(default = "default_sub_panel_hover_opacity")]
    pub sub_panel_hover_opacity: f32,
    #[serde(default = "default_sub_panel_text_size")]
    pub sub_panel_text_size: f32,
    #[serde(default = "default_text_color")]
    pub sub_panel_text_color: String,
    #[serde(default)]
    pub gesture_path_debug: bool,
    /// Record rich gesture samples (zones / child-switch events) for tuning thresholds.
    #[serde(default)]
    pub gesture_path_capture: bool,
    /// Below this radius (pie px), child may switch by angle. At/above: child freezes.
    #[serde(default = "default_gesture_child_switch_max")]
    pub gesture_child_switch_max: f32,
    /// Enter grandchild selection at/above this radius (folder child).
    #[serde(default = "default_gesture_grand_enter")]
    pub gesture_grand_enter: f32,
    /// Enter grandchild selection for hybrid child (has path + children).
    #[serde(default = "default_gesture_grand_enter_hybrid")]
    pub gesture_grand_enter_hybrid: f32,
    /// On entry sector only: drop grand when distance falls below this.
    #[serde(default = "default_gesture_retrace_grand")]
    pub gesture_retrace_grand: f32,
    /// On entry sector only: drop child when distance falls below this.
    #[serde(default = "default_gesture_retrace_child")]
    pub gesture_retrace_child: f32,
    #[serde(default = "default_prefs_bg")]
    pub prefs_bg: String,
    #[serde(default = "default_prefs_accent")]
    pub prefs_accent: String,
    #[serde(default = "default_prefs_text")]
    pub prefs_text: String,
    /// "normal" | "liquid_glass"
    #[serde(default = "default_prefs_chrome")]
    pub prefs_chrome: String,
    #[serde(default = "default_center_label")]
    pub center_label: String,
    /// Relative path under app config dir, e.g. "assets/center-logo.png"
    #[serde(default)]
    pub center_logo: String,
    #[serde(default)]
    pub panel_overlay: String,
    #[serde(default = "default_panel_overlay_opacity")]
    pub panel_overlay_opacity: f32,
}

fn default_hover_animation() -> String {
    "none".to_string()
}

fn default_hover_opacity() -> f32 {
    1.0
}

fn default_sub_panel_opacity() -> f32 {
    0.6 // Slightly lower than main panel default
}

fn default_drag_opacity() -> f32 {
    0.3 // Default opacity for inactive slices while dragging
}

fn default_sub_panel_hover_opacity() -> f32 {
    0.8 // Opacity when hovering a sub-panel slice
}

fn default_sub_panel_text_size() -> f32 {
    12.0
}

fn default_text_color() -> String {
    "#ffffff".to_string()
}

fn default_gesture_child_switch_max() -> f32 {
    // Midpoint of child ring (180–300): inner half = switch, outer half = path→grand
    240.0
}

fn default_gesture_grand_enter() -> f32 {
    300.0
}

fn default_gesture_grand_enter_hybrid() -> f32 {
    320.0
}

fn default_gesture_retrace_grand() -> f32 {
    180.0
}

fn default_gesture_retrace_child() -> f32 {
    140.0
}

fn default_prefs_bg() -> String {
    "#252830".to_string()
}

fn default_prefs_accent() -> String {
    "#6366f1".to_string()
}

fn default_prefs_text() -> String {
    "#ffffff".to_string()
}

fn default_prefs_chrome() -> String {
    "normal".to_string()
}

fn default_center_label() -> String {
    "HUE".to_string()
}

fn default_panel_overlay_opacity() -> f32 {
    0.18
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
            hover_animation: default_hover_animation(),
            hover_opacity: default_hover_opacity(),
            sub_panel_opacity: default_sub_panel_opacity(),
            drag_opacity: default_drag_opacity(),
            sub_panel_hover_opacity: default_sub_panel_hover_opacity(),
            sub_panel_text_size: default_sub_panel_text_size(),
            sub_panel_text_color: default_text_color(),
            gesture_path_debug: false,
            gesture_path_capture: false,
            gesture_child_switch_max: default_gesture_child_switch_max(),
            gesture_grand_enter: default_gesture_grand_enter(),
            gesture_grand_enter_hybrid: default_gesture_grand_enter_hybrid(),
            gesture_retrace_grand: default_gesture_retrace_grand(),
            gesture_retrace_child: default_gesture_retrace_child(),
            prefs_bg: default_prefs_bg(),
            prefs_accent: default_prefs_accent(),
            prefs_text: default_prefs_text(),
            prefs_chrome: default_prefs_chrome(),
            center_label: default_center_label(),
            center_logo: String::new(),
            panel_overlay: String::new(),
            panel_overlay_opacity: default_panel_overlay_opacity(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct AutoConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub folder: String,
    #[serde(default)]
    pub tag: String,
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
pub struct MenuItem {
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub children: Vec<MenuItem>,
    #[serde(default)]
    pub auto: Option<AutoConfig>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AutoEntry {
    pub name: String,
    pub path: String,
}

const AUTO_ENTRY_CAP: usize = 256;

pub fn auto_enabled(item: &MenuItem) -> bool {
    item.auto.as_ref().is_some_and(|a| a.enabled)
}

pub fn auto_folder(item: &MenuItem) -> &str {
    item.auto
        .as_ref()
        .filter(|a| a.enabled)
        .map(|a| a.folder.as_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(item.path.as_str())
}

pub fn auto_tag(item: &MenuItem) -> &str {
    item.auto.as_ref().map(|a| a.tag.as_str()).unwrap_or("")
}

/// List files and folders directly inside `folder` (non-recursive).
/// Empty / whitespace `tag` → include every entry. Non-empty → name contains tag (case-insensitive).
pub fn list_auto_entries(folder: &str, tag: &str) -> Result<Vec<AutoEntry>, String> {
    let dir = std::path::Path::new(folder.trim());
    if !dir.is_dir() {
        return Err(format!("Not a folder: {}", folder));
    }

    let tag_lower = tag.trim().to_lowercase();
    let filter_by_tag = !tag_lower.is_empty();
    let mut entries: Vec<AutoEntry> = Vec::new();

    let read_dir = fs::read_dir(dir).map_err(|e| format!("Failed to read folder: {e}"))?;
    for entry in read_dir {
        let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
        let path = entry.path();
        // Non-recursive: only the immediate files and folders
        let is_dir = path.is_dir();
        let is_file = path.is_file();
        if !is_dir && !is_file {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        if file_name.starts_with('.') {
            continue;
        }
        if filter_by_tag && !file_name.to_lowercase().contains(&tag_lower) {
            continue;
        }
        let display = if is_dir {
            file_name.to_string()
        } else {
            path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(file_name)
                .to_string()
        };
        entries.push(AutoEntry {
            name: display,
            path: path.to_string_lossy().into_owned(),
        });
        if entries.len() >= AUTO_ENTRY_CAP {
            break;
        }
    }

    // Folders first, then files; alphabetical within each group
    entries.sort_by(|a, b| {
        let a_dir = std::path::Path::new(&a.path).is_dir();
        let b_dir = std::path::Path::new(&b.path).is_dir();
        match (a_dir, b_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });
    Ok(entries)
}

fn sync_item_children(item: &mut MenuItem) -> bool {
    let mut changed = false;
    if auto_enabled(item) {
        let folder = auto_folder(item).to_string();
        let tag = auto_tag(item).to_string();
        match list_auto_entries(&folder, &tag) {
            Ok(entries) => {
                let new_children: Vec<MenuItem> = entries
                    .into_iter()
                    .map(|e| MenuItem {
                        name: e.name,
                        path: e.path,
                        children: vec![],
                        auto: None,
                    })
                    .collect();
                if item.children != new_children {
                    item.children = new_children;
                    changed = true;
                }
            }
            Err(err) => {
                eprintln!("[Hue auto] sync failed for {}: {err}", folder);
            }
        }
        // Auto owns this node's children as a flat file list — do not recurse
        // (would fight nested Auto and get wiped on the next parent sync).
        return changed;
    }
    for child in item.children.iter_mut() {
        if sync_item_children(child) {
            changed = true;
        }
    }
    changed
}

pub fn sync_auto_items(config: &mut MenuConfig) -> bool {
    let mut changed = false;
    for item in config.items.iter_mut() {
        if sync_item_children(item) {
            changed = true;
        }
    }
    changed
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
                    children: vec![
                        MenuItem {
                            name: "PowerShell".into(),
                            path: "powershell.exe".into(),
                            children: vec![],
                            auto: None,
                        },
                        MenuItem {
                            name: "CMD".into(),
                            path: "cmd.exe".into(),
                            children: vec![],
                            auto: None,
                        },
                        MenuItem {
                            name: "WSL".into(),
                            path: "wsl.exe".into(),
                            children: vec![],
                            auto: None,
                        },
                    ],
                    auto: None,
                },
                MenuItem {
                    name: "Browser".into(),
                    path: "chrome.exe".into(),
                    children: vec![],
                    auto: None,
                },
                MenuItem {
                    name: "Explorer".into(),
                    path: "explorer.exe".into(),
                    children: vec![],
                    auto: None,
                },
                MenuItem {
                    name: "Notepad".into(),
                    path: "notepad.exe".into(),
                    children: vec![],
                    auto: None,
                },
                MenuItem {
                    name: "Settings".into(),
                    path: "ms-settings:".into(),
                    children: vec![],
                    auto: None,
                },
                MenuItem {
                    name: "TaskMgr".into(),
                    path: "taskmgr.exe".into(),
                    children: vec![],
                    auto: None,
                },
                MenuItem {
                    name: "Calc".into(),
                    path: "calc.exe".into(),
                    children: vec![],
                    auto: None,
                },
                MenuItem {
                    name: "Paint".into(),
                    path: "mspaint.exe".into(),
                    children: vec![],
                    auto: None,
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

pub fn get_assets_dir(app_handle: &AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_config_dir()
        .unwrap_or_default()
        .join("assets")
}

pub fn resolve_asset_path(app_handle: &AppHandle, rel: &str) -> Option<PathBuf> {
    let rel = rel.trim();
    if rel.is_empty() {
        return None;
    }
    let path = app_handle
        .path()
        .app_config_dir()
        .ok()?
        .join(rel);
    if path.is_file() {
        Some(path)
    } else {
        None
    }
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
