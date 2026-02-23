import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
    const [activeTab, setActiveTab] = useState<'general' | 'appearance'>('general');
    const [shortcut, setShortcut] = useState(config.global_shortcut || 'alt+space');

    // Appearance state
    const [opacity, setOpacity] = useState(config.appearance?.panel_opacity ?? 0.8);
    const [panelColor, setPanelColor] = useState(config.appearance?.panel_color ?? '#333333');
    const [textSize, setTextSize] = useState(config.appearance?.text_size ?? 14);
    const [textColor, setTextColor] = useState(config.appearance?.text_color ?? '#ffffff');
    const [animType, setAnimType] = useState(config.appearance?.animation_type ?? 'spread');
    const [hoverScale, setHoverScale] = useState(config.appearance?.hover_scale ?? 'small');

    const [isRecording, setIsRecording] = useState(false);
    const [saving, setSaving] = useState(false);

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
                    panel_color: panelColor,
                    text_size: textSize,
                    text_color: textColor,
                    animation_type: animType,
                    hover_scale: hoverScale,
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
            <div data-tauri-drag-region className="preferences-header">
                Hue Preferences
            </div>

            <div className="preferences-tabs">
                <button
                    className={activeTab === 'general' ? 'active' : ''}
                    onClick={() => setActiveTab('general')}
                >
                    General
                </button>
                <button
                    className={activeTab === 'appearance' ? 'active' : ''}
                    onClick={() => setActiveTab('appearance')}
                >
                    Appearance
                </button>
            </div>

            <div className="preferences-body">
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

                {activeTab === 'appearance' && (
                    <>
                        <div className="pref-row">
                            <label>Background Color</label>
                            <input
                                type="color"
                                value={panelColor}
                                onChange={(e) => setPanelColor(e.target.value)}
                            />
                        </div>
                        <div className="pref-row">
                            <label>Panel Opacity</label>
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
                            <label>Text Color</label>
                            <input
                                type="color"
                                value={textColor}
                                onChange={(e) => setTextColor(e.target.value)}
                            />
                        </div>
                        <div className="pref-row">
                            <label>Text Size</label>
                            <input
                                type="number"
                                min="8"
                                max="32"
                                value={textSize}
                                onChange={(e) => setTextSize(parseInt(e.target.value, 10) || 14)}
                                style={{ width: '60px' }}
                            />
                        </div>
                        <div className="pref-row">
                            <label>Open Animation</label>
                            <select
                                value={animType}
                                onChange={(e) => setAnimType(e.target.value)}
                                style={{
                                    background: 'rgba(255, 255, 255, 0.1)',
                                    color: 'white',
                                    border: '1px solid rgba(255, 255, 255, 0.2)',
                                    padding: '4px',
                                    borderRadius: '4px'
                                }}
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
                                value={hoverScale}
                                onChange={(e) => setHoverScale(e.target.value)}
                                style={{
                                    background: 'rgba(255, 255, 255, 0.1)',
                                    color: 'white',
                                    border: '1px solid rgba(255, 255, 255, 0.2)',
                                    padding: '4px',
                                    borderRadius: '4px'
                                }}
                            >
                                <option value="none">None (1.0x)</option>
                                <option value="small">Small (1.05x)</option>
                                <option value="medium">Medium (1.10x)</option>
                                <option value="large">Large (1.15x)</option>
                            </select>
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
        </div>
    );
};
