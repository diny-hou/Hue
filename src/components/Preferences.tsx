import React, { useState, useEffect } from 'react';
import { getName, getTauriVersion, getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isEnabled, enable, disable } from '@tauri-apps/plugin-autostart';
import { MenuConfig } from './PieMenu'; // Will export MenuConfig from PieMenu.tsx shortly

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

    if (!config) return <div style={{ color: '#ffffff', padding: '20px', background: '#222', borderRadius: '8px' }}>Loading Preferences... (Check Console)</div>;

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
    const [activeTab, setActiveTab] = useState<'general' | 'theme' | 'opacity' | 'animations' | 'advanced'>('general');
    const [shortcut, setShortcut] = useState(config.global_shortcut || 'alt+space');

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

    const [isRecording, setIsRecording] = useState(false);
    const [saving, setSaving] = useState(false);
    const [autoStart, setAutoStart] = useState(false);
    const [appName, setAppName] = useState('Hue');
    const [appVersion, setAppVersion] = useState('…');
    const [tauriVersion, setTauriVersion] = useState('…');

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

            // Fetch the CURRENT config from disk to preserve items
            // (they may have been modified by other commands like empty_all_slices)
            const currentConfig = await invoke<MenuConfig>('get_config');

            // Only update appearance and shortcut, keep items from disk
            const newConfig: MenuConfig = {
                ...currentConfig,
                global_shortcut: shortcut,
                appearance: {
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
                }
            };
            await invoke('update_config', { newConfig });

            onSaved();
        } catch (e) {
            console.error('Failed to update config:', e);
            alert('Failed to save settings.');
        } finally {
            setSaving(false);
        }
    };

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
                            <label style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>Sub-panel Text</label>
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
                            <label>Panel Opacity (Sub)</label>
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
                            <label>Sub-panel Hover Opacity</label>
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
                    </>
                )}
            </div>

            <div className="preferences-footer">
                <button className="pref-save" onClick={handleSave} disabled={saving || isRecording}>
                    {saving ? 'Saving...' : 'Apply'}
                </button>
                <button className="pref-cancel" onClick={onClose} disabled={saving}>
                    Close
                </button>
            </div>
        </div >
    );
};
