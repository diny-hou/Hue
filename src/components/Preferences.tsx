import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MenuConfig } from './PieMenu'; // Will export MenuConfig from PieMenu.tsx shortly

interface PreferencesProps {
    config: MenuConfig;
    onClose: () => void;
    onSaved: () => void;
}

export const Preferences: React.FC<PreferencesProps> = ({ config, onClose, onSaved }) => {
    const [shortcut, setShortcut] = useState(config.global_shortcut || 'alt+space');
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
            await invoke('update_shortcut', { newShortcut: shortcut });
            onSaved();
        } catch (e) {
            console.error('Failed to update shortcut:', e);
            alert('Failed to register shortcut. Is it already in use by another app?');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            className="preferences-modal"
            onContextMenu={e => e.preventDefault()}
            onPointerDown={e => e.stopPropagation()}
            onPointerUp={e => e.stopPropagation()}
        >
            <div data-tauri-drag-region className="preferences-header">
                Hue Preferences
            </div>

            <div className="preferences-body">
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
