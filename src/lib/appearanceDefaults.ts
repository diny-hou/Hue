import type { AppearanceConfig } from '../components/PieMenu';

export const DEFAULT_APPEARANCE: AppearanceConfig = {
    panel_opacity: 0.8,
    panel_color: '#333333',
    text_size: 14,
    text_color: '#ffffff',
    animation_type: 'spread',
    hover_scale: 'small',
    hover_animation: 'none',
    hover_opacity: 1.0,
    sub_panel_opacity: 0.6,
    drag_opacity: 0.3,
    sub_panel_hover_opacity: 0.8,
    sub_panel_text_size: 12,
    sub_panel_text_color: '#ffffff',
    gesture_path_debug: false,
    gesture_path_capture: false,
    gesture_child_switch_max: 240,
    gesture_grand_enter: 300,
    gesture_grand_enter_hybrid: 320,
    gesture_retrace_grand: 180,
    gesture_retrace_child: 140,
    prefs_bg: '#252830',
    prefs_accent: '#6366f1',
    prefs_text: '#ffffff',
    prefs_chrome: 'normal',
    center_label: 'HUE',
    center_logo: '',
    panel_overlay: '',
    panel_overlay_opacity: 0.18,
    parent_ring_thickness: 110,
    child_ring_thickness: 120,
    grand_ring_thickness: 120,
};

export type AppearancePreviewPayload = AppearanceConfig & {
    previewTab?: 'theme' | 'opacity' | 'animations' | 'advanced' | 'general' | 'auto' | null;
    replayOpenAnimation?: boolean;
};

export const THEME_DEFAULT_KEYS: (keyof AppearanceConfig)[] = [
    'panel_color',
    'text_color',
    'text_size',
    'sub_panel_text_color',
    'sub_panel_text_size',
    'prefs_bg',
    'prefs_accent',
    'prefs_text',
    'prefs_chrome',
    'center_label',
    'center_logo',
    'panel_overlay',
    'panel_overlay_opacity',
    'parent_ring_thickness',
    'child_ring_thickness',
    'grand_ring_thickness',
];

export const OPACITY_DEFAULT_KEYS: (keyof AppearanceConfig)[] = [
    'panel_opacity',
    'hover_opacity',
    'sub_panel_opacity',
    'sub_panel_hover_opacity',
    'drag_opacity',
];

export const ANIMATION_DEFAULT_KEYS: (keyof AppearanceConfig)[] = [
    'animation_type',
    'hover_scale',
    'hover_animation',
];

export const ADVANCED_GESTURE_DEFAULT_KEYS: (keyof AppearanceConfig)[] = [
    'gesture_path_debug',
    'gesture_path_capture',
    'gesture_child_switch_max',
    'gesture_grand_enter',
    'gesture_grand_enter_hybrid',
    'gesture_retrace_grand',
    'gesture_retrace_child',
];

export function pickAppearanceDefaults(keys: (keyof AppearanceConfig)[]): Partial<AppearanceConfig> {
    const out: Partial<AppearanceConfig> = {};
    for (const k of keys) {
        (out as Record<string, unknown>)[k] = DEFAULT_APPEARANCE[k];
    }
    return out;
}
