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
    ring_span_scale: 1.0,
    parent_ring_weight: 110,
    child_ring_weight: 120,
    grand_ring_weight: 120,
    gesture_child_split_ratio: 0.5,
    gesture_path_pick_ratio: 0.636,
    gesture_retrace_child_ratio: 0.636,
    gesture_grand_hybrid_extra_ratio: 0.167,
    prefs_bg: '#252830',
    prefs_accent: '#6366f1',
    prefs_text: '#ffffff',
    prefs_chrome: 'normal',
    center_label: 'HUE',
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
    'ring_span_scale',
    'parent_ring_weight',
    'child_ring_weight',
    'grand_ring_weight',
    'gesture_child_split_ratio',
    'gesture_path_pick_ratio',
    'gesture_retrace_child_ratio',
    'gesture_grand_hybrid_extra_ratio',
];

export const OPACITY_DEFAULT_KEYS: (keyof AppearanceConfig)[] = [
    'panel_opacity',
    'hover_opacity',
    'sub_panel_opacity',
    'sub_panel_hover_opacity',
    'drag_opacity',
];

export const RING_SIZE_DEFAULT_KEYS: (keyof AppearanceConfig)[] = [
    'ring_span_scale',
    'parent_ring_weight',
    'child_ring_weight',
    'grand_ring_weight',
];

export const GESTURE_HIT_ZONE_DEFAULT_KEYS: (keyof AppearanceConfig)[] = [
    'gesture_child_split_ratio',
    'gesture_path_pick_ratio',
    'gesture_retrace_child_ratio',
    'gesture_grand_hybrid_extra_ratio',
];

export const ANIMATION_DEFAULT_KEYS: (keyof AppearanceConfig)[] = [
    'animation_type',
    'hover_scale',
    'hover_animation',
];

export const ADVANCED_GESTURE_DEFAULT_KEYS: (keyof AppearanceConfig)[] = [
    'gesture_path_debug',
    'gesture_path_capture',
];

export function pickAppearanceDefaults(keys: (keyof AppearanceConfig)[]): Partial<AppearanceConfig> {
    const out: Partial<AppearanceConfig> = {};
    for (const k of keys) {
        (out as Record<string, unknown>)[k] = DEFAULT_APPEARANCE[k];
    }
    return out;
}
