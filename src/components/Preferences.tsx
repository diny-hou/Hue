import React, { useState, useEffect, useRef, useMemo } from 'react';
import { getName, getTauriVersion, getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isEnabled, enable, disable } from '@tauri-apps/plugin-autostart';
import { ArrowDown, ArrowUp, FolderOpen } from 'lucide-react';
import { AppearanceConfig, MenuConfig } from './PieMenu';
import { SliceItem } from './SliceEditor';
import { UpdateDialog } from './UpdateDialog';
import { useAppUpdater } from '../hooks/useAppUpdater';
import {
    ADVANCED_GESTURE_DEFAULT_KEYS,
    ANIMATION_DEFAULT_KEYS,
    DEFAULT_APPEARANCE,
    GESTURE_HIT_ZONE_DEFAULT_KEYS,
    OPACITY_DEFAULT_KEYS,
    RING_SIZE_DEFAULT_KEYS,
    THEME_DEFAULT_KEYS,
    pickAppearanceDefaults,
    type AppearancePreviewPayload,
} from '../lib/appearanceDefaults';
import { ringWeightPercents, resolveRingGeometry } from '../lib/ringGeometry';
import {
    HOVER_ANIMATION_OPTIONS,
    HOVER_SCALE_OPTIONS,
    OPEN_ANIMATION_OPTIONS,
    PREFS_CHROME_OPTIONS,
    PrefSelect,
} from './PrefSelect';

function PrefTabReset({ onReset }: { onReset: () => void }) {
    return (
        <button type="button" className="pref-tab-reset" onClick={onReset}>
            Reset to defaults
        </button>
    );
}

type AutoDepth = 'parent' | 'child' | 'grand';

type AutoListEntry = {
    depth: AutoDepth;
    mainIndex: number;
    childIndex: number | null;
    grandIndex: number | null;
    name: string;
    folder: string;
    tag: string;
    context?: string;
};

function cloneItems(items: SliceItem[]): SliceItem[] {
    return JSON.parse(JSON.stringify(items)) as SliceItem[];
}

/** Map a keydown to a global-hotkey token (letters, digits, space, arrows, F-keys). */
function shortcutKeyFromEvent(e: KeyboardEvent): string | null {
    const { code, key } = e;
    if (code === 'Space') return 'space';
    if (code.startsWith('Key') && code.length === 4) return code.slice(3).toLowerCase();
    if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
    if (/^F\d{1,2}$/.test(code)) return code.toLowerCase();

    const byCode: Record<string, string> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        Escape: 'esc',
        Tab: 'tab',
        Enter: 'enter',
        Backspace: 'backspace',
        Delete: 'delete',
        Home: 'home',
        End: 'end',
        PageUp: 'pageup',
        PageDown: 'pagedown',
        Minus: 'minus',
        Equal: 'equal',
        BracketLeft: 'bracketleft',
        BracketRight: 'bracketright',
        Semicolon: 'semicolon',
        Quote: 'quote',
        Backquote: 'backquote',
        Backslash: 'backslash',
        Comma: 'comma',
        Period: 'period',
        Slash: 'slash',
    };
    if (byCode[code]) return byCode[code];

    // Fallback for simple printable keys (never use '+' — it breaks alt+… parsing)
    if (key.length === 1 && key !== '+') return key.toLowerCase();
    return null;
}

function collectAutoEntries(items: SliceItem[]): AutoListEntry[] {
    const out: AutoListEntry[] = [];
    items.forEach((main, mi) => {
        if (main.auto?.enabled) {
            out.push({
                depth: 'parent',
                mainIndex: mi,
                childIndex: null,
                grandIndex: null,
                name: main.name.trim() || `Parent ${mi + 1}`,
                folder: main.auto.folder?.trim() || main.path || '',
                tag: main.auto.tag ?? '',
            });
        }
        (main.children || []).forEach((child, ci) => {
            if (child.auto?.enabled) {
                out.push({
                    depth: 'child',
                    mainIndex: mi,
                    childIndex: ci,
                    grandIndex: null,
                    name: child.name.trim() || `Child ${ci + 1}`,
                    folder: child.auto.folder?.trim() || child.path || '',
                    tag: child.auto.tag ?? '',
                    context: main.name.trim() || `Parent ${mi + 1}`,
                });
            }
            (child.children || []).forEach((grand, gi) => {
                if (grand.auto?.enabled) {
                    out.push({
                        depth: 'grand',
                        mainIndex: mi,
                        childIndex: ci,
                        grandIndex: gi,
                        name: grand.name.trim() || `Grand ${gi + 1}`,
                        folder: grand.auto.folder?.trim() || grand.path || '',
                        tag: grand.auto.tag ?? '',
                        context: `${main.name.trim() || `Parent ${mi + 1}`} › ${child.name.trim() || `Child ${ci + 1}`}`,
                    });
                }
            });
        });
    });
    return out;
}

function getAutoItem(items: SliceItem[], entry: AutoListEntry): SliceItem | null {
    const main = items[entry.mainIndex];
    if (!main) return null;
    if (entry.grandIndex !== null && entry.childIndex !== null) {
        return main.children?.[entry.childIndex]?.children?.[entry.grandIndex] ?? null;
    }
    if (entry.childIndex !== null) {
        return main.children?.[entry.childIndex] ?? null;
    }
    return main;
}

function patchAutoItem(
    items: SliceItem[],
    entry: AutoListEntry,
    patch: { folder?: string; tag?: string },
): SliceItem[] {
    const next = cloneItems(items);
    const item = getAutoItem(next, entry);
    if (!item) return items;
    item.auto = {
        enabled: true,
        folder: patch.folder ?? item.auto?.folder ?? '',
        tag: patch.tag ?? item.auto?.tag ?? '',
    };
    return next;
}

function swapIndices<T>(arr: T[], a: number, b: number): T[] {
    if (a < 0 || b < 0 || a >= arr.length || b >= arr.length || a === b) return arr;
    const copy = [...arr];
    const tmp = copy[a];
    copy[a] = copy[b];
    copy[b] = tmp;
    return copy;
}

export const StandalonePreferences: React.FC = () => {
    const [config, setConfig] = useState<MenuConfig | null>(null);
    const [configEpoch, setConfigEpoch] = useState(0);

    useEffect(() => {
        const load = () => {
            invoke<MenuConfig>('get_config')
                .then(c => {
                    setConfig(c);
                    setConfigEpoch(n => n + 1);
                })
                .catch(err => {
                    console.error('Failed to fetch config:', err);
                });
        };

        load();

        // Webview is hidden (not destroyed) on close — reload when opened again.
        let unlisten: (() => void) | undefined;
        void getCurrentWindow()
            .listen('preferences-reload', () => { load(); })
            .then(fn => { unlisten = fn; });

        return () => { unlisten?.(); };
    }, []);

    if (!config) return (
        <div className="preferences-shell">
            <div className="preferences-modal" style={{ justifyContent: 'center', alignItems: 'center' }}>
                <span style={{ color: '#ffffff', fontSize: 14 }}>Loading preferences…</span>
            </div>
        </div>
    );

    const handleWindowClose = async () => {
        try {
            await invoke('close_preferences_window');
        } catch (e) {
            console.error("Failed to close window:", e);
        }
    };

    return (
        <Preferences
            key={configEpoch}
            config={config}
            onClose={handleWindowClose}
            onSaved={handleWindowClose}
        />
    );
};

interface PreferencesProps {
    config: MenuConfig;
    onClose: () => void;
    onSaved: () => void;
}

export const Preferences: React.FC<PreferencesProps> = ({ config, onClose, onSaved }) => {
    const [activeTab, setActiveTab] = useState<'general' | 'theme' | 'opacity' | 'animations' | 'auto' | 'advanced'>('general');
    const [shortcut, setShortcut] = useState(config.global_shortcut || 'alt+space');
    const [menuItems, setMenuItems] = useState<SliceItem[]>(() => cloneItems(config.items || []));
    const [autoDirty, setAutoDirty] = useState(false);
    const [autoBrowseBusy, setAutoBrowseBusy] = useState(false);

    const setMenuItemsDirty = (updater: React.SetStateAction<SliceItem[]>) => {
        setAutoDirty(true);
        setMenuItems(updater);
    };

    // Appearance state
    const [opacity, setOpacity] = useState(config.appearance?.panel_opacity ?? 0.8);
    const [hoverOpacity, setHoverOpacity] = useState(config.appearance?.hover_opacity ?? 1.0);
    const [subPanelOpacity, setSubPanelOpacity] = useState(config.appearance?.sub_panel_opacity ?? 0.6);
    const [subPanelHoverOpacity, setSubPanelHoverOpacity] = useState(config.appearance?.sub_panel_hover_opacity ?? 0.8);
    const [dragOpacity, setDragOpacity] = useState(config.appearance?.drag_opacity ?? 0.3);
    const [panelColor, setPanelColor] = useState(config.appearance?.panel_color ?? '#333333');
    const [textSize, setTextSize] = useState(config.appearance?.text_size ?? 14);
    const [textColor, setTextColor] = useState(config.appearance?.text_color ?? '#ffffff');
    const [subPanelTextSize, setSubPanelTextSize] = useState(config.appearance?.sub_panel_text_size ?? 12);
    const [subPanelTextColor, setSubPanelTextColor] = useState(config.appearance?.sub_panel_text_color ?? '#ffffff');
    const [animType, setAnimType] = useState(config.appearance?.animation_type ?? 'spread');
    const [hoverScale, setHoverScale] = useState(config.appearance?.hover_scale ?? 'small');
    const [hoverAnim, setHoverAnim] = useState(config.appearance?.hover_animation || 'none');
    const [gesturePathDebug, setGesturePathDebug] = useState(!!config.appearance?.gesture_path_debug);
    const [gesturePathCapture, setGesturePathCapture] = useState(!!config.appearance?.gesture_path_capture);
    const [ringSpanScale, setRingSpanScale] = useState(config.appearance?.ring_span_scale ?? DEFAULT_APPEARANCE.ring_span_scale!);
    const [parentRingWeight, setParentRingWeight] = useState(config.appearance?.parent_ring_weight ?? DEFAULT_APPEARANCE.parent_ring_weight!);
    const [childRingWeight, setChildRingWeight] = useState(config.appearance?.child_ring_weight ?? DEFAULT_APPEARANCE.child_ring_weight!);
    const [grandRingWeight, setGrandRingWeight] = useState(config.appearance?.grand_ring_weight ?? DEFAULT_APPEARANCE.grand_ring_weight!);
    const [childSplitRatio, setChildSplitRatio] = useState(config.appearance?.gesture_child_split_ratio ?? DEFAULT_APPEARANCE.gesture_child_split_ratio!);
    const [pathPickRatio, setPathPickRatio] = useState(config.appearance?.gesture_path_pick_ratio ?? DEFAULT_APPEARANCE.gesture_path_pick_ratio!);
    const [retraceChildRatio, setRetraceChildRatio] = useState(config.appearance?.gesture_retrace_child_ratio ?? DEFAULT_APPEARANCE.gesture_retrace_child_ratio!);
    const [grandHybridExtraRatio, setGrandHybridExtraRatio] = useState(
        config.appearance?.gesture_grand_hybrid_extra_ratio ?? DEFAULT_APPEARANCE.gesture_grand_hybrid_extra_ratio!,
    );
    const [prefsBg, setPrefsBg] = useState(config.appearance?.prefs_bg ?? DEFAULT_APPEARANCE.prefs_bg!);
    const [prefsAccent, setPrefsAccent] = useState(config.appearance?.prefs_accent ?? DEFAULT_APPEARANCE.prefs_accent!);
    const [prefsText, setPrefsText] = useState(config.appearance?.prefs_text ?? DEFAULT_APPEARANCE.prefs_text!);
    const [prefsChrome, setPrefsChrome] = useState(config.appearance?.prefs_chrome ?? DEFAULT_APPEARANCE.prefs_chrome!);
    const [centerLabel, setCenterLabel] = useState(config.appearance?.center_label ?? DEFAULT_APPEARANCE.center_label!);

    const [isRecording, setIsRecording] = useState(false);
    const [saving, setSaving] = useState(false);
    const [autoStart, setAutoStart] = useState(false);
    const [appName, setAppName] = useState('Hue');
    const [appVersion, setAppVersion] = useState('…');
    const [tauriVersion, setTauriVersion] = useState('…');
    const updater = useAppUpdater();
    const previewReadyRef = useRef(false);
    const replayAnimRef = useRef(false);

    const previewRingGeometry = useMemo(
        () =>
            resolveRingGeometry({
                ring_span_scale: ringSpanScale,
                parent_ring_weight: parentRingWeight,
                child_ring_weight: childRingWeight,
                grand_ring_weight: grandRingWeight,
            } as AppearanceConfig),
        [ringSpanScale, parentRingWeight, childRingWeight, grandRingWeight],
    );
    const ringPercents = useMemo(() => ringWeightPercents(previewRingGeometry), [previewRingGeometry]);

    const buildAppearance = (): AppearanceConfig => ({
        panel_opacity: opacity,
        hover_opacity: hoverOpacity,
        sub_panel_opacity: subPanelOpacity,
        sub_panel_hover_opacity: subPanelHoverOpacity,
        drag_opacity: dragOpacity,
        panel_color: panelColor,
        text_size: textSize,
        text_color: textColor,
        sub_panel_text_size: subPanelTextSize,
        sub_panel_text_color: subPanelTextColor,
        animation_type: animType,
        hover_scale: hoverScale,
        hover_animation: hoverAnim,
        gesture_path_debug: gesturePathDebug,
        gesture_path_capture: gesturePathCapture,
        ring_span_scale: ringSpanScale,
        parent_ring_weight: parentRingWeight,
        child_ring_weight: childRingWeight,
        grand_ring_weight: grandRingWeight,
        gesture_child_split_ratio: childSplitRatio,
        gesture_path_pick_ratio: pathPickRatio,
        gesture_retrace_child_ratio: retraceChildRatio,
        gesture_grand_hybrid_extra_ratio: grandHybridExtraRatio,
        prefs_bg: prefsBg,
        prefs_accent: prefsAccent,
        prefs_text: prefsText,
        prefs_chrome: prefsChrome,
        center_label: centerLabel,
    });

    const emitPreview = (extra?: Partial<AppearancePreviewPayload>) => {
        const payload: AppearancePreviewPayload = {
            ...buildAppearance(),
            previewTab: activeTab,
            replayOpenAnimation: replayAnimRef.current || extra?.replayOpenAnimation,
            ...extra,
        };
        replayAnimRef.current = false;
        void emit('appearance-preview', payload);
    };

    const applyDefaults = (keys: (keyof AppearanceConfig)[], extra?: Partial<AppearancePreviewPayload>) => {
        const d = pickAppearanceDefaults(keys);
        if (d.panel_opacity !== undefined) setOpacity(d.panel_opacity);
        if (d.hover_opacity !== undefined) setHoverOpacity(d.hover_opacity);
        if (d.sub_panel_opacity !== undefined) setSubPanelOpacity(d.sub_panel_opacity);
        if (d.sub_panel_hover_opacity !== undefined) setSubPanelHoverOpacity(d.sub_panel_hover_opacity);
        if (d.drag_opacity !== undefined) setDragOpacity(d.drag_opacity);
        if (d.panel_color !== undefined) setPanelColor(d.panel_color);
        if (d.text_size !== undefined) setTextSize(d.text_size);
        if (d.text_color !== undefined) setTextColor(d.text_color);
        if (d.sub_panel_text_size !== undefined) setSubPanelTextSize(d.sub_panel_text_size);
        if (d.sub_panel_text_color !== undefined) setSubPanelTextColor(d.sub_panel_text_color);
        if (d.animation_type !== undefined) setAnimType(d.animation_type);
        if (d.hover_scale !== undefined) setHoverScale(d.hover_scale);
        if (d.hover_animation !== undefined) setHoverAnim(d.hover_animation);
        if (d.gesture_path_debug !== undefined) setGesturePathDebug(d.gesture_path_debug);
        if (d.gesture_path_capture !== undefined) setGesturePathCapture(d.gesture_path_capture);
        if (d.ring_span_scale !== undefined) setRingSpanScale(d.ring_span_scale);
        if (d.parent_ring_weight !== undefined) setParentRingWeight(d.parent_ring_weight);
        if (d.child_ring_weight !== undefined) setChildRingWeight(d.child_ring_weight);
        if (d.grand_ring_weight !== undefined) setGrandRingWeight(d.grand_ring_weight);
        if (d.gesture_child_split_ratio !== undefined) setChildSplitRatio(d.gesture_child_split_ratio);
        if (d.gesture_path_pick_ratio !== undefined) setPathPickRatio(d.gesture_path_pick_ratio);
        if (d.gesture_retrace_child_ratio !== undefined) setRetraceChildRatio(d.gesture_retrace_child_ratio);
        if (d.gesture_grand_hybrid_extra_ratio !== undefined) setGrandHybridExtraRatio(d.gesture_grand_hybrid_extra_ratio);
        if (d.prefs_bg !== undefined) setPrefsBg(d.prefs_bg);
        if (d.prefs_accent !== undefined) setPrefsAccent(d.prefs_accent);
        if (d.prefs_text !== undefined) setPrefsText(d.prefs_text);
        if (d.prefs_chrome !== undefined) setPrefsChrome(d.prefs_chrome);
        if (d.center_label !== undefined) setCenterLabel(d.center_label);
        window.setTimeout(() => emitPreview(extra), 0);
    };

    const resetAllAppearance = () => {
        if (!window.confirm('Reset all appearance settings to defaults? Shortcut and menu items are kept until you Apply.')) {
            return;
        }
        applyDefaults(Object.keys(DEFAULT_APPEARANCE) as (keyof AppearanceConfig)[], { replayOpenAnimation: true });
    };

    // Live-preview appearance (esp. threshold rings) on the main pie while Preferences is open
    useEffect(() => {
        if (!previewReadyRef.current) {
            previewReadyRef.current = true;
            return;
        }
        const timer = window.setTimeout(() => {
            emitPreview();
        }, 40);
        return () => window.clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional live preview deps
    }, [
        opacity, hoverOpacity, subPanelOpacity, subPanelHoverOpacity, dragOpacity,
        panelColor, textSize, textColor, subPanelTextSize, subPanelTextColor,
        animType, hoverScale, hoverAnim,
        gesturePathDebug, gesturePathCapture,
        ringSpanScale, parentRingWeight, childRingWeight, grandRingWeight,
        childSplitRatio, pathPickRatio, retraceChildRatio, grandHybridExtraRatio,
        prefsBg, prefsAccent, prefsText, prefsChrome,
        centerLabel,
        activeTab,
    ]);

    useEffect(() => {
        isEnabled()
            .then(setAutoStart)
            .catch(err => console.error("Failed to check autostart status:", err));
    }, []);

    useEffect(() => {
        Promise.all([getName(), getVersion(), getTauriVersion()])
            .then(([name, version, tauri]) => {
                setAppName(name);
                setAppVersion(version);
                setTauriVersion(tauri);
                document.title = `${name} Preferences v${version}`;
            })
            .catch(err => console.error("Failed to load app version info:", err));
    }, []);

    const handleToggleAutoStart = async () => {
        try {
            if (autoStart) {
                await disable();
                setAutoStart(false);
            } else {
                await enable();
                setAutoStart(true);
            }
        } catch (e) {
            console.error("Failed to toggle autostart:", e);
        }
    };

    useEffect(() => {
        if (!isRecording) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();

            // Ignore standalone modifiers
            if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
                return;
            }

            const keyStr = shortcutKeyFromEvent(e);
            if (!keyStr) return;

            const keys: string[] = [];
            if (e.ctrlKey) keys.push('ctrl');
            if (e.shiftKey) keys.push('shift');
            if (e.altKey) keys.push('alt');
            if (e.metaKey) keys.push('super');
            keys.push(keyStr);

            setShortcut(keys.join('+'));
            setIsRecording(false);
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [isRecording]);

    const handleSave = async () => {
        if (!shortcut) return;
        setSaving(true);
        try {
            // Always re-register with the OS. Preferences stays mounted while hidden, so
            // comparing against the initial config prop can skip the real hotkey update.
            await invoke('update_shortcut', { newShortcut: shortcut });

            // Fetch the CURRENT config from disk to preserve unrelated fields
            const currentConfig = await invoke<MenuConfig>('get_config');

            const newConfig: MenuConfig = {
                ...currentConfig,
                global_shortcut: shortcut,
                appearance: buildAppearance(),
                items: autoDirty ? menuItems : currentConfig.items,
            };
            await invoke('update_config', { newConfig });
            if (autoDirty) {
                const synced = await invoke<MenuConfig>('sync_auto_items').catch(() => null);
                if (synced) setMenuItems(cloneItems(synced.items));
                setAutoDirty(false);
            }

            onSaved();
        } catch (e) {
            console.error('Failed to update config:', e);
            alert(`Failed to save settings: ${e}`);
        } finally {
            setSaving(false);
        }
    };

    const autoEntries = useMemo(() => collectAutoEntries(menuItems), [menuItems]);

    const pickAutoFolder = async (entry: AutoListEntry) => {
        setAutoBrowseBusy(true);
        try {
            await invoke('set_native_dialog_open', { open: true });
            const picked = await invoke<string | null>('pick_folder');
            if (picked) {
                setMenuItemsDirty(prev => patchAutoItem(prev, entry, { folder: picked }));
            }
        } finally {
            await invoke('set_native_dialog_open', { open: false }).catch(() => {});
            setAutoBrowseBusy(false);
        }
    };

    const moveAutoEntry = (entry: AutoListEntry, direction: -1 | 1) => {
        setMenuItemsDirty(prev => {
            if (entry.depth === 'parent') {
                const parentIdxs = collectAutoEntries(prev)
                    .filter(e => e.depth === 'parent')
                    .map(e => e.mainIndex);
                const pos = parentIdxs.indexOf(entry.mainIndex);
                const other = parentIdxs[pos + direction];
                if (other === undefined) return prev;
                return swapIndices(prev, entry.mainIndex, other);
            }
            if (entry.depth === 'child' && entry.childIndex !== null) {
                const siblingIdxs = collectAutoEntries(prev)
                    .filter(e => e.depth === 'child' && e.mainIndex === entry.mainIndex)
                    .map(e => e.childIndex!)
                    .sort((a, b) => a - b);
                const pos = siblingIdxs.indexOf(entry.childIndex);
                const other = siblingIdxs[pos + direction];
                if (other === undefined) return prev;
                const next = cloneItems(prev);
                const kids = next[entry.mainIndex]?.children;
                if (!kids) return prev;
                next[entry.mainIndex].children = swapIndices(kids, entry.childIndex, other);
                return next;
            }
            if (entry.depth === 'grand' && entry.childIndex !== null && entry.grandIndex !== null) {
                const siblingIdxs = collectAutoEntries(prev)
                    .filter(e =>
                        e.depth === 'grand'
                        && e.mainIndex === entry.mainIndex
                        && e.childIndex === entry.childIndex
                    )
                    .map(e => e.grandIndex!)
                    .sort((a, b) => a - b);
                const pos = siblingIdxs.indexOf(entry.grandIndex);
                const other = siblingIdxs[pos + direction];
                if (other === undefined) return prev;
                const next = cloneItems(prev);
                const grands = next[entry.mainIndex]?.children?.[entry.childIndex]?.children;
                if (!grands) return prev;
                next[entry.mainIndex].children![entry.childIndex].children = swapIndices(
                    grands,
                    entry.grandIndex,
                    other,
                );
                return next;
            }
            return prev;
        });
    };

    const canMoveAuto = (entry: AutoListEntry, direction: -1 | 1): boolean => {
        if (entry.depth === 'parent') {
            const parentIdxs = autoEntries.filter(e => e.depth === 'parent').map(e => e.mainIndex);
            const pos = parentIdxs.indexOf(entry.mainIndex);
            return parentIdxs[pos + direction] !== undefined;
        }
        if (entry.depth === 'child' && entry.childIndex !== null) {
            const siblingIdxs = autoEntries
                .filter(e => e.depth === 'child' && e.mainIndex === entry.mainIndex)
                .map(e => e.childIndex!)
                .sort((a, b) => a - b);
            const pos = siblingIdxs.indexOf(entry.childIndex);
            return siblingIdxs[pos + direction] !== undefined;
        }
        if (entry.depth === 'grand' && entry.childIndex !== null && entry.grandIndex !== null) {
            const siblingIdxs = autoEntries
                .filter(e =>
                    e.depth === 'grand'
                    && e.mainIndex === entry.mainIndex
                    && e.childIndex === entry.childIndex
                )
                .map(e => e.grandIndex!)
                .sort((a, b) => a - b);
            const pos = siblingIdxs.indexOf(entry.grandIndex);
            return siblingIdxs[pos + direction] !== undefined;
        }
        return false;
    };

    const depthLabel = (d: AutoDepth) =>
        d === 'parent' ? 'Parent' : d === 'child' ? 'Child' : 'Grand';

    const handleEmptyAllSlices = async () => {
        console.log('[Preferences] Empty All Slices button clicked');
        try {
            setSaving(true);
            console.log('[Preferences] Calling invoke empty_all_slices...');
            await invoke('empty_all_slices');
            console.log('[Preferences] invoke succeeded!');
        } catch (e) {
            console.error('[Preferences] Failed to empty slices:', e);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="preferences-shell">
            <div
                className={`preferences-modal${prefsChrome === 'liquid_glass' ? ' preferences-modal--liquid-glass' : ''}`}
                style={{
                    ['--prefs-bg' as string]: prefsBg,
                    ['--prefs-accent' as string]: prefsAccent,
                    ['--prefs-text' as string]: prefsText,
                    color: prefsText,
                }}
                onContextMenu={e => e.preventDefault()}
            >
            <div
                className="preferences-header"
                onPointerDown={(e) => {
                    if (e.button === 0) {
                        getCurrentWindow().startDragging()
                            .catch(err => console.error("Failed to drag window:", err));
                    }
                }}
            >
                <div className="preferences-header-text">
                    <span>Hue Preferences</span>
                    <span className="preferences-version">v{appVersion}</span>
                </div>
                <p className="preferences-marking-hint">
                    Drag on the pie to test marking gestures — preview only, nothing launches.
                </p>
            </div>

            <div className="pref-tabs">
                <button
                    className={activeTab === 'general' ? 'active' : ''}
                    onClick={() => setActiveTab('general')}
                >General</button>
                <button
                    className={activeTab === 'theme' ? 'active' : ''}
                    onClick={() => setActiveTab('theme')}
                >Theme</button>
                <button
                    className={activeTab === 'opacity' ? 'active' : ''}
                    onClick={() => setActiveTab('opacity')}
                >Opacity</button>
                <button
                    className={activeTab === 'animations' ? 'active' : ''}
                    onClick={() => setActiveTab('animations')}
                >Animations</button>
                <button
                    className={activeTab === 'auto' ? 'active' : ''}
                    onClick={() => setActiveTab('auto')}
                >Auto</button>
                <button
                    className={activeTab === 'advanced' ? 'active' : ''}
                    onClick={() => setActiveTab('advanced')}
                >Advanced</button>
            </div>

            <div className="pref-tab-content">
                {activeTab === 'general' && (
                    <>
                        <div className="pref-row">
                            <label>Global Hotkey</label>
                            <div className="pref-shortcut-input">
                                <button
                                    className={`pref-record-btn ${isRecording ? 'recording' : ''}`}
                                    onClick={() => setIsRecording(true)}
                                >
                                    {isRecording ? 'Listening...' : shortcut}
                                </button>
                            </div>
                        </div>
                        <div className="pref-row" style={{ marginTop: '8px' }}>
                            <small style={{ color: '#aaa' }}>
                                <em>Note: Changes to shortcut take effect immediately upon saving.</em>
                            </small>
                        </div>
                        <div className="pref-row" style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '20px' }}>
                            <label>Run on System Startup</label>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={autoStart}
                                    onChange={handleToggleAutoStart}
                                />
                                <span className="slider round"></span>
                            </label>
                        </div>
                        <div className="pref-row" style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '20px' }}>
                            <label>Software Update</label>
                            <div className="pref-update-actions">
                                <button
                                    type="button"
                                    className="pref-update-btn"
                                    onClick={() => void updater.runUpdate()}
                                    disabled={updater.isBusy}
                                >
                                    {updater.phase === 'checking'
                                        ? 'Checking…'
                                        : updater.isBusy
                                            ? 'Updating…'
                                            : 'Check for updates'}
                                </button>
                                {updater.statusMessage && (
                                    <p className={`pref-update-status${updater.phase === 'uptodate' ? ' success' : ''}`}>
                                        {updater.statusMessage}
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="pref-row" style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '20px' }}>
                            <label style={{ color: '#ff6b6b' }}>Danger Zone</label>
                            <button
                                onClick={handleEmptyAllSlices}
                                disabled={saving}
                                style={{
                                    background: 'rgba(255, 50, 50, 0.2)',
                                    border: '1px solid rgba(255, 50, 50, 0.5)',
                                    color: '#ffaaaa',
                                    padding: '8px 16px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    width: '100%',
                                    transition: 'all 0.2s'
                                }}
                                onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255, 50, 50, 0.4)'}
                                onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255, 50, 50, 0.2)'}
                            >
                                Empty All Slices
                            </button>
                        </div>
                    </>
                )}

                {activeTab === 'theme' && (
                    <>
                        <div className="pref-tab-toolbar">
                            <span className="pref-tab-toolbar-title">Pie &amp; text</span>
                            <PrefTabReset onReset={() => applyDefaults(THEME_DEFAULT_KEYS.filter(k =>
                                !['prefs_bg', 'prefs_accent', 'prefs_text', 'prefs_chrome', 'center_label', 'ring_span_scale', 'parent_ring_weight', 'child_ring_weight', 'grand_ring_weight', 'gesture_child_split_ratio', 'gesture_path_pick_ratio', 'gesture_retrace_child_ratio', 'gesture_grand_hybrid_extra_ratio'].includes(k)
                            ))} />
                        </div>
                        <div className="pref-row">
                            <label>Panel Color</label>
                            <input
                                type="color"
                                value={panelColor}
                                onChange={(e) => setPanelColor(e.target.value)}
                            />
                        </div>
                        <div className="pref-row">
                            <label>Text Color</label>
                            <input
                                type="color"
                                value={textColor}
                                onChange={(e) => setTextColor(e.target.value)}
                            />
                        </div>
                        <div className="pref-row">
                            <label>Text Size</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input
                                    type="range"
                                    min="10"
                                    max="24"
                                    step="1"
                                    value={textSize}
                                    onChange={(e) => setTextSize(parseInt(e.target.value))}
                                />
                                <span style={{ fontSize: '12px', minWidth: '3ch' }}>{textSize}px</span>
                            </div>
                        </div>
                        <div className="pref-row" style={{ marginTop: '12px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px' }}>
                            <label style={{ fontSize: '14px', fontWeight: 600 }}>Sub / Nested Text</label>
                        </div>
                        <div className="pref-row">
                            <label>Text Color</label>
                            <input
                                type="color"
                                value={subPanelTextColor}
                                onChange={(e) => setSubPanelTextColor(e.target.value)}
                            />
                        </div>
                        <div className="pref-row">
                            <label>Text Size</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input
                                    type="range"
                                    min="8"
                                    max="20"
                                    step="1"
                                    value={subPanelTextSize}
                                    onChange={(e) => setSubPanelTextSize(parseInt(e.target.value))}
                                />
                                <span style={{ fontSize: '12px', minWidth: '3ch' }}>{subPanelTextSize}px</span>
                            </div>
                        </div>

                        <div className="pref-tab-toolbar" style={{ marginTop: '16px' }}>
                            <span className="pref-tab-toolbar-title">Ring size</span>
                            <PrefTabReset onReset={() => applyDefaults(RING_SIZE_DEFAULT_KEYS)} />
                        </div>
                        <div className="pref-row">
                            <label>Overall size</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                                <input
                                    type="range"
                                    min="70"
                                    max="130"
                                    step="1"
                                    style={{ flex: 1 }}
                                    value={Math.round(ringSpanScale * 100)}
                                    onChange={(e) => setRingSpanScale(Number(e.target.value) / 100)}
                                />
                                <span className="pref-value-numeric">{Math.round(ringSpanScale * 100)}%</span>
                            </div>
                        </div>
                        <div className="pref-row">
                            <label>Parent ring</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                                <input
                                    type="range"
                                    min="60"
                                    max="200"
                                    step="5"
                                    style={{ flex: 1 }}
                                    value={parentRingWeight}
                                    onChange={(e) => setParentRingWeight(Number(e.target.value))}
                                />
                                <span className="pref-value-numeric">{ringPercents.parent}%</span>
                            </div>
                        </div>
                        <div className="pref-row">
                            <label>Child ring</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                                <input
                                    type="range"
                                    min="60"
                                    max="200"
                                    step="5"
                                    style={{ flex: 1 }}
                                    value={childRingWeight}
                                    onChange={(e) => setChildRingWeight(Number(e.target.value))}
                                />
                                <span className="pref-value-numeric">{ringPercents.child}%</span>
                            </div>
                        </div>
                        <div className="pref-row">
                            <label>Grand ring</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                                <input
                                    type="range"
                                    min="60"
                                    max="200"
                                    step="5"
                                    style={{ flex: 1 }}
                                    value={grandRingWeight}
                                    onChange={(e) => setGrandRingWeight(Number(e.target.value))}
                                />
                                <span className="pref-value-numeric">{ringPercents.grand}%</span>
                            </div>
                        </div>
                        <small className="pref-hint">
                            Radial thickness of each ring band. Percentages show each ring&apos;s share of the total band.
                        </small>

                        <div className="pref-tab-toolbar" style={{ marginTop: '16px' }}>
                            <span className="pref-tab-toolbar-title">Hit zone lines</span>
                            <PrefTabReset onReset={() => applyDefaults(GESTURE_HIT_ZONE_DEFAULT_KEYS)} />
                        </div>
                        <div className="pref-row">
                            <label>Child half split</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                                <input
                                    type="range"
                                    min="20"
                                    max="80"
                                    step="1"
                                    style={{ flex: 1 }}
                                    value={Math.round(childSplitRatio * 100)}
                                    onChange={(e) => setChildSplitRatio(Number(e.target.value) / 100)}
                                />
                                <span className="pref-value-numeric">{Math.round(childSplitRatio * 100)}%</span>
                            </div>
                        </div>
                        <div className="pref-row">
                            <label>Path pick depth</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                                <input
                                    type="range"
                                    min="40"
                                    max="90"
                                    step="1"
                                    style={{ flex: 1 }}
                                    value={Math.round(pathPickRatio * 100)}
                                    onChange={(e) => setPathPickRatio(Number(e.target.value) / 100)}
                                />
                                <span className="pref-value-numeric">{Math.round(pathPickRatio * 100)}%</span>
                            </div>
                        </div>
                        <div className="pref-row">
                            <label>Retrace child</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                                <input
                                    type="range"
                                    min="40"
                                    max="90"
                                    step="1"
                                    style={{ flex: 1 }}
                                    value={Math.round(retraceChildRatio * 100)}
                                    onChange={(e) => setRetraceChildRatio(Number(e.target.value) / 100)}
                                />
                                <span className="pref-value-numeric">{Math.round(retraceChildRatio * 100)}%</span>
                            </div>
                        </div>
                        <div className="pref-row">
                            <label>Grand hybrid extra</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                                <input
                                    type="range"
                                    min="5"
                                    max="35"
                                    step="1"
                                    style={{ flex: 1 }}
                                    value={Math.round(grandHybridExtraRatio * 100)}
                                    onChange={(e) => setGrandHybridExtraRatio(Number(e.target.value) / 100)}
                                />
                                <span className="pref-value-numeric">{Math.round(grandHybridExtraRatio * 100)}%</span>
                            </div>
                        </div>
                        <small className="pref-hint">
                            Judgment lines scale with ring size. Half split is a depth within the child ring (20–80%). Path pick and retrace are depths within the parent ring. Grand enter follows the child outer edge automatically.
                        </small>

                        <div className="pref-tab-toolbar" style={{ marginTop: '16px' }}>
                            <span className="pref-tab-toolbar-title">Center label</span>
                        </div>
                        <div className="pref-row">
                            <label>Center label</label>
                            <input
                                className="pref-text-input"
                                type="text"
                                value={centerLabel}
                                maxLength={24}
                                onChange={(e) => setCenterLabel(e.target.value)}
                                placeholder="HUE"
                            />
                        </div>

                        <div className="pref-tab-toolbar" style={{ marginTop: '16px' }}>
                            <span className="pref-tab-toolbar-title">Preferences window</span>
                            <PrefTabReset onReset={() => applyDefaults(['prefs_bg', 'prefs_accent', 'prefs_text', 'prefs_chrome'])} />
                        </div>
                        <div className="pref-row">
                            <label>Background</label>
                            <input type="color" value={prefsBg} onChange={(e) => setPrefsBg(e.target.value)} />
                        </div>
                        <div className="pref-row">
                            <label>Accent</label>
                            <input type="color" value={prefsAccent} onChange={(e) => setPrefsAccent(e.target.value)} />
                        </div>
                        <div className="pref-row">
                            <label>Text</label>
                            <input type="color" value={prefsText} onChange={(e) => setPrefsText(e.target.value)} />
                        </div>
                        <div className="pref-row">
                            <label>Chrome style</label>
                            <PrefSelect
                                value={prefsChrome}
                                options={PREFS_CHROME_OPTIONS}
                                onChange={setPrefsChrome}
                            />
                        </div>
                    </>
                )}

                {activeTab === 'opacity' && (
                    <>
                        <div className="pref-tab-toolbar">
                            <span className="pref-tab-toolbar-title">Opacity</span>
                            <PrefTabReset onReset={() => applyDefaults(OPACITY_DEFAULT_KEYS)} />
                        </div>
                        <div className="pref-row">
                            <label>Panel Opacity (Main)</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input
                                    type="range"
                                    min="0.1"
                                    max="1.0"
                                    step="0.05"
                                    value={opacity}
                                    onChange={(e) => setOpacity(parseFloat(e.target.value))}
                                />
                                <span style={{ fontSize: '12px', minWidth: '3ch' }}>{Math.round(opacity * 100)}%</span>
                            </div>
                        </div>
                        <div className="pref-row">
                            <label>Panel Opacity (Sub / Nested)</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input
                                    type="range"
                                    min="0.1"
                                    max="1.0"
                                    step="0.05"
                                    value={subPanelOpacity}
                                    onChange={(e) => setSubPanelOpacity(parseFloat(e.target.value))}
                                />
                                <span style={{ fontSize: '12px', minWidth: '3ch' }}>{Math.round(subPanelOpacity * 100)}%</span>
                            </div>
                        </div>
                        <div className="pref-row">
                            <label>Hover Opacity</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input
                                    type="range"
                                    min="0.1"
                                    max="1.0"
                                    step="0.05"
                                    value={hoverOpacity}
                                    onChange={(e) => setHoverOpacity(parseFloat(e.target.value))}
                                />
                                <span style={{ fontSize: '12px', minWidth: '3ch' }}>{Math.round(hoverOpacity * 100)}%</span>
                            </div>
                        </div>
                        <div className="pref-row">
                            <label>Sub / Nested Hover Opacity</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input
                                    type="range"
                                    min="0.1"
                                    max="1.0"
                                    step="0.05"
                                    value={subPanelHoverOpacity}
                                    onChange={(e) => setSubPanelHoverOpacity(parseFloat(e.target.value))}
                                />
                                <span style={{ fontSize: '12px', minWidth: '3ch' }}>{Math.round(subPanelHoverOpacity * 100)}%</span>
                            </div>
                        </div>
                        <div className="pref-row">
                            <label>Drag Opacity</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                                <input
                                    type="range"
                                    min="0.1"
                                    max="1.0"
                                    step="0.05"
                                    style={{ flex: 1 }}
                                    value={dragOpacity}
                                    onChange={(e) => setDragOpacity(parseFloat(e.target.value))}
                                />
                                <span style={{ fontSize: '12px', minWidth: '3ch' }}>{Math.round(dragOpacity * 100)}%</span>
                            </div>
                        </div>
                        <div className="pref-row" style={{ marginTop: '0px' }}>
                            <small style={{ color: '#aaa', marginLeft: 'auto', display: 'block', textAlign: 'right', fontSize: '11px' }}>
                                (Inactive during marking drag)
                            </small>
                        </div>
                    </>
                )}

                {activeTab === 'animations' && (
                    <>
                        <div className="pref-tab-toolbar">
                            <span className="pref-tab-toolbar-title">Animations</span>
                            <PrefTabReset onReset={() => applyDefaults(ANIMATION_DEFAULT_KEYS, { replayOpenAnimation: true })} />
                        </div>
                        <div className="pref-row">
                            <label>Open Animation</label>
                            <PrefSelect
                                value={animType}
                                options={OPEN_ANIMATION_OPTIONS}
                                onChange={(v) => {
                                    replayAnimRef.current = true;
                                    setAnimType(v);
                                }}
                            />
                        </div>
                        <div className="pref-row">
                            <label>Hover Scale</label>
                            <PrefSelect
                                value={hoverScale}
                                options={HOVER_SCALE_OPTIONS}
                                onChange={setHoverScale}
                            />
                        </div>
                        <div className="pref-row">
                            <label>Hover Animation</label>
                            <PrefSelect
                                value={hoverAnim}
                                options={HOVER_ANIMATION_OPTIONS}
                                onChange={setHoverAnim}
                            />
                        </div>
                        <small className="pref-hint">Open animation replays on the pie when you change it. Hover effects show on the demo slice.</small>
                    </>
                )}

                {activeTab === 'auto' && (
                    <>
                        <div className="pref-row">
                            <label style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>Auto folders</label>
                        </div>
                        <div className="pref-row" style={{ marginTop: '4px' }}>
                            <small style={{ color: '#aaa' }}>
                                Registered Auto sources by depth. Empty tag = files and folders in that directory only (not recursive).
                                Reorder with arrows, change folder/tag, then Apply.
                            </small>
                        </div>
                        {autoEntries.length === 0 ? (
                            <p className="pref-auto-empty">
                                No Auto folders yet. Right-click a parent or child panel → enable Auto → pick a folder.
                            </p>
                        ) : (
                            <div className="pref-auto-list">
                                {(['parent', 'child', 'grand'] as AutoDepth[]).map(depth => {
                                    const group = autoEntries.filter(e => e.depth === depth);
                                    if (group.length === 0) return null;
                                    return (
                                        <React.Fragment key={depth}>
                                            <div className="pref-auto-group-title">{depthLabel(depth)}</div>
                                            {group.map(entry => (
                                                <div
                                                    key={`${entry.depth}-${entry.mainIndex}-${entry.childIndex}-${entry.grandIndex}`}
                                                    className="pref-auto-row"
                                                >
                                                    <div className="pref-auto-row-head">
                                                        <span className="pref-auto-depth">{depthLabel(entry.depth)}</span>
                                                        <span className="pref-auto-label">{entry.name}</span>
                                                        {entry.context && (
                                                            <small style={{ color: '#888' }}>under {entry.context}</small>
                                                        )}
                                                        <div className="pref-auto-reorder">
                                                            <button
                                                                type="button"
                                                                title="Move up"
                                                                disabled={!canMoveAuto(entry, -1)}
                                                                onClick={() => moveAutoEntry(entry, -1)}
                                                            >
                                                                <ArrowUp size={14} />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                title="Move down"
                                                                disabled={!canMoveAuto(entry, 1)}
                                                                onClick={() => moveAutoEntry(entry, 1)}
                                                            >
                                                                <ArrowDown size={14} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <label className="slice-editor-label" style={{ margin: 0 }}>Folder</label>
                                                    <div className="pref-auto-path-row">
                                                        <input
                                                            className="slice-editor-input"
                                                            type="text"
                                                            value={entry.folder}
                                                            onChange={e => {
                                                                const folder = e.target.value;
                                                                setMenuItemsDirty(prev => patchAutoItem(prev, entry, { folder }));
                                                            }}
                                                            placeholder="Folder path"
                                                        />
                                                        <button
                                                            type="button"
                                                            className="slice-editor-browse"
                                                            disabled={autoBrowseBusy}
                                                            title="Browse folder"
                                                            onClick={() => void pickAutoFolder(entry)}
                                                        >
                                                            <FolderOpen size={16} />
                                                        </button>
                                                    </div>
                                                    <label className="slice-editor-label" style={{ margin: 0 }}>
                                                        Tag (empty = all files)
                                                    </label>
                                                    <input
                                                        className="slice-editor-input"
                                                        type="text"
                                                        value={entry.tag}
                                                        onChange={e => {
                                                            const tag = e.target.value;
                                                            setMenuItemsDirty(prev => patchAutoItem(prev, entry, { tag }));
                                                        }}
                                                        placeholder="Optional filename filter"
                                                    />
                                                </div>
                                            ))}
                                        </React.Fragment>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}

                {activeTab === 'advanced' && (
                    <>
                        <div className="pref-row">
                            <label style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>About</label>
                        </div>
                        <div className="pref-row">
                            <label>App</label>
                            <span className="pref-value">{appName}</span>
                        </div>
                        <div className="pref-row">
                            <label>Version</label>
                            <span className="pref-value">v{appVersion}</span>
                        </div>
                        <div className="pref-row">
                            <label>Tauri</label>
                            <span className="pref-value">v{tauriVersion}</span>
                        </div>
                        <div className="pref-tab-toolbar" style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px' }}>
                            <span className="pref-tab-toolbar-title">Gesture thresholds</span>
                            <PrefTabReset onReset={() => applyDefaults(ADVANCED_GESTURE_DEFAULT_KEYS)} />
                        </div>
                        <div className="pref-row">
                            <label>Gesture Path Debug</label>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={gesturePathDebug}
                                    onChange={(e) => setGesturePathDebug(e.target.checked)}
                                />
                                <span className="slider round"></span>
                            </label>
                        </div>
                        <div className="pref-row" style={{ marginTop: '4px' }}>
                            <small style={{ color: '#aaa' }}>
                                Show trail, threshold rings, and lock HUD while dragging.
                            </small>
                        </div>
                        <div className="pref-row" style={{ marginTop: '12px' }}>
                            <label>Gesture Path Capture</label>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={gesturePathCapture}
                                    onChange={(e) => setGesturePathCapture(e.target.checked)}
                                />
                                <span className="slider round"></span>
                            </label>
                        </div>
                        <div className="pref-row" style={{ marginTop: '4px' }}>
                            <small style={{ color: '#aaa' }}>
                                Color trail by zone (green=child switchable, amber=frozen, cyan=grand, pink=retrace).
                                On release, samples go to DevTools console and localStorage key hue_last_gesture_capture.
                            </small>
                        </div>

                        <div className="pref-row" style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '20px' }}>
                            <small style={{ color: '#aaa' }}>
                                Ring size and gesture hit zones are tuned on the Theme tab as percentages. Enable path debug above to see live rings on the pie while dragging.
                            </small>
                        </div>
                    </>
                )}
            </div>

            <UpdateDialog
                phase={updater.phase}
                update={updater.update}
                downloaded={updater.downloaded}
                contentLength={updater.contentLength}
                error={updater.error}
                onClose={updater.reset}
            />

            <div className="preferences-footer">
                <button type="button" className="pref-reset-all" onClick={resetAllAppearance} disabled={saving || isRecording}>
                    Reset appearance
                </button>
                <div className="preferences-footer-actions">
                    <button className="pref-save" onClick={handleSave} disabled={saving || isRecording}>
                        {saving ? 'Saving...' : 'Apply'}
                    </button>
                    <button className="pref-cancel" onClick={onClose} disabled={saving}>
                        Close
                    </button>
                </div>
            </div>
            </div>
        </div>
    );
};
