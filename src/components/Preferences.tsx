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

    useEffect(() => {
        console.log("StandalonePreferences mounted, fetching config...");
        invoke<MenuConfig>('get_config')
            .then(c => {
                console.log("Config fetched successfully:", c);
                setConfig(c);
            })
            .catch(err => {
                console.error("Failed to fetch config:", err);
            });
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

    return <Preferences config={config} onClose={handleWindowClose} onSaved={handleWindowClose} />;
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
    const [childSwitchMax, setChildSwitchMax] = useState(
        // 240 = midpoint of child ring (180–300); migrate previous default 250 → mid
        (config.appearance?.gesture_child_switch_max === 250
            ? 240
            : config.appearance?.gesture_child_switch_max) ?? 240,
    );
    const [grandEnter, setGrandEnter] = useState(config.appearance?.gesture_grand_enter ?? 300);
    const [grandEnterHybrid, setGrandEnterHybrid] = useState(config.appearance?.gesture_grand_enter_hybrid ?? 320);
    const [retraceGrand, setRetraceGrand] = useState(config.appearance?.gesture_retrace_grand ?? 180);
    const [retraceChild, setRetraceChild] = useState(config.appearance?.gesture_retrace_child ?? 140);

    const [isRecording, setIsRecording] = useState(false);
    const [saving, setSaving] = useState(false);
    const [autoStart, setAutoStart] = useState(false);
    const [appName, setAppName] = useState('Hue');
    const [appVersion, setAppVersion] = useState('…');
    const [tauriVersion, setTauriVersion] = useState('…');
    const updater = useAppUpdater();
    const previewReadyRef = useRef(false);

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
        gesture_child_switch_max: childSwitchMax,
        gesture_grand_enter: grandEnter,
        gesture_grand_enter_hybrid: grandEnterHybrid,
        gesture_retrace_grand: retraceGrand,
        gesture_retrace_child: retraceChild,
    });

    // Live-preview appearance (esp. threshold rings) on the main pie while Preferences is open
    useEffect(() => {
        if (!previewReadyRef.current) {
            previewReadyRef.current = true;
            return;
        }
        const timer = window.setTimeout(() => {
            void emit('appearance-preview', buildAppearance());
        }, 40);
        return () => window.clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional live preview deps
    }, [
        opacity, hoverOpacity, subPanelOpacity, subPanelHoverOpacity, dragOpacity,
        panelColor, textSize, textColor, subPanelTextSize, subPanelTextColor,
        animType, hoverScale, hoverAnim,
        gesturePathDebug, gesturePathCapture,
        childSwitchMax, grandEnter, grandEnterHybrid, retraceGrand, retraceChild,
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

            const keys: string[] = [];
            if (e.ctrlKey) keys.push('ctrl');
            if (e.shiftKey) keys.push('shift');
            if (e.altKey) keys.push('alt');
            if (e.metaKey) keys.push('super');

            // Handle spacebar explicitly
            const keyStr = e.code === 'Space' ? 'space' : e.key.toLowerCase();
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
            // First update the shortcut separately because it handles OS registration
            if (shortcut !== config.global_shortcut) {
                await invoke('update_shortcut', { newShortcut: shortcut });
            }

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
            alert('Failed to save settings.');
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
                className="preferences-modal"
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
                <span>Hue Preferences</span>
                <span className="preferences-version">v{appVersion}</span>
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
                        <div className="pref-row" style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '20px' }}>
                            <label style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>Sub / Nested Text</label>
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
                    </>
                )}

                {activeTab === 'opacity' && (
                    <>
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
                        <div className="pref-row">
                            <label>Open Animation</label>
                            <select
                                className="pref-select"
                                value={animType}
                                onChange={(e) => setAnimType(e.target.value)}
                            >
                                <option value="none">None (Instant)</option>
                                <option value="spread">Spread</option>
                                <option value="fade">Fade</option>
                                <option value="bounce">Bounce</option>
                            </select>
                        </div>
                        <div className="pref-row">
                            <label>Hover Scale</label>
                            <select
                                className="pref-select"
                                value={hoverScale}
                                onChange={(e) => setHoverScale(e.target.value)}
                            >
                                <option value="none">None (1.0x)</option>
                                <option value="small">Small (1.05x)</option>
                                <option value="medium">Medium (1.10x)</option>
                                <option value="large">Large (1.15x)</option>
                            </select>
                        </div>
                        <div className="pref-row">
                            <label>Hover Animation</label>
                            <select
                                className="pref-select"
                                value={hoverAnim}
                                onChange={(e) => setHoverAnim(e.target.value)}
                            >
                                <option value="none">None</option>
                                <option value="pulse">Pulse</option>
                                <option value="glow">Glow</option>
                                <option value="wobble">Wobble</option>
                            </select>
                        </div>
                    </>
                )}

                {activeTab === 'auto' && (
                    <>
                        <div className="pref-row">
                            <label style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>Auto folders</label>
                        </div>
                        <div className="pref-row" style={{ marginTop: '4px' }}>
                            <small style={{ color: '#aaa' }}>
                                Registered Auto sources by depth. Empty tag = all files in that folder only (not recursive).
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
                        <div className="pref-row" style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '20px' }}>
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
                            <label style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>Gesture Thresholds</label>
                        </div>
                        <div className="pref-row" style={{ marginTop: '4px' }}>
                            <small style={{ color: '#aaa' }}>
                                Live preview on the pie (rings + labels update as you drag).
                                Apply to save. Close without Apply discards preview.
                                Child half split: inner = switch child · outer = path→grand.
                            </small>
                        </div>
                        <div className="pref-row">
                            <label>Child Half Split ({childSwitchMax})</label>
                            <input
                                type="range"
                                min={180}
                                max={300}
                                step={1}
                                value={childSwitchMax}
                                onChange={(e) => setChildSwitchMax(Number(e.target.value))}
                            />
                        </div>
                        <div className="pref-row">
                            <label>Grand Enter ({grandEnter})</label>
                            <input
                                type="range"
                                min={260}
                                max={380}
                                step={1}
                                value={grandEnter}
                                onChange={(e) => setGrandEnter(Number(e.target.value))}
                            />
                        </div>
                        <div className="pref-row">
                            <label>Grand Enter Hybrid ({grandEnterHybrid})</label>
                            <input
                                type="range"
                                min={280}
                                max={400}
                                step={1}
                                value={grandEnterHybrid}
                                onChange={(e) => setGrandEnterHybrid(Number(e.target.value))}
                            />
                        </div>
                        <div className="pref-row">
                            <label>Retrace Grand ({retraceGrand})</label>
                            <input
                                type="range"
                                min={100}
                                max={280}
                                step={1}
                                value={retraceGrand}
                                onChange={(e) => setRetraceGrand(Number(e.target.value))}
                            />
                        </div>
                        <div className="pref-row">
                            <label>Retrace Child ({retraceChild})</label>
                            <input
                                type="range"
                                min={70}
                                max={220}
                                step={1}
                                value={retraceChild}
                                onChange={(e) => setRetraceChild(Number(e.target.value))}
                            />
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
                <button className="pref-save" onClick={handleSave} disabled={saving || isRecording}>
                    {saving ? 'Saving...' : 'Apply'}
                </button>
                <button className="pref-cancel" onClick={onClose} disabled={saving}>
                    Close
                </button>
            </div>
            </div>
        </div>
    );
};
