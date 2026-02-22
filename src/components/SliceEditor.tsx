import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface SliceItem {
    name: string;
    path: string;
    children: SliceItem[];
}

interface SliceEditorProps {
    item: SliceItem;
    position?: { x: number; y: number }; // Optional for standalone window
    onSave: (item: SliceItem) => void;
    onCancel: () => void;
}

export const SliceEditor: React.FC<SliceEditorProps> = ({ item, position, onSave, onCancel }) => {
    const [name, setName] = useState(item.name);
    const [path, setPath] = useState(item.path);
    const [loading, setLoading] = useState(false);
    const inputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        // Prevent browser scrollIntoView which shifts the whole flex container
        inputRef.current?.focus({ preventScroll: true });
    }, []);

    const handleBrowse = async () => {
        setLoading(true);
        try {
            const picked = await invoke<string | null>('pick_file');
            if (picked) {
                setPath(picked);
                // Auto-fill name from filename if still default / empty
                if (!name || name === item.name) {
                    let auto = picked.split('\\').pop()?.split('/').pop() || '';
                    if (auto.endsWith('.exe')) auto = auto.slice(0, -4);
                    if (auto) setName(auto);
                }
            }
        } finally {
            setLoading(false);
        }
    };

    const handleSave = () => {
        if (!name.trim()) return;
        onSave({ ...item, name: name.trim(), path: path.trim() });
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSave();
        if (e.key === 'Escape') onCancel();
        e.stopPropagation(); // prevent pie menu events
    };

    const style: React.CSSProperties = position ? {
        left: `${position.x}px`,
        top: `${position.y}px`,
        position: 'absolute',
        transform: 'translate(-50%, -50%)'
    } : {
        width: '100%',
        height: '100%',
        boxSizing: 'border-box'
    };

    return (
        <div
            className="slice-editor"
            style={style}
            onPointerDown={e => e.stopPropagation()}
            onPointerUp={e => e.stopPropagation()}
            onContextMenu={e => e.preventDefault()}
            onKeyDown={handleKeyDown}
        >
            <div className="slice-editor-title" data-tauri-drag-region>Edit Panel</div>

            <label className="slice-editor-label">Label</label>
            <input
                ref={inputRef}
                className="slice-editor-input"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="App name"
            />

            <label className="slice-editor-label">Path / Command</label>
            <div className="slice-editor-path-row">
                <input
                    className="slice-editor-input"
                    type="text"
                    value={path}
                    onChange={e => setPath(e.target.value)}
                    placeholder="C:\path\to\app.exe"
                />
                <button
                    className="slice-editor-browse"
                    onClick={handleBrowse}
                    disabled={loading}
                    title="Browse…"
                >
                    {loading ? '…' : '📂'}
                </button>
            </div>

            <div className="slice-editor-actions">
                <button className="slice-editor-save" onClick={handleSave}>Save</button>
                <button className="slice-editor-cancel" onClick={onCancel}>Cancel</button>
            </div>
        </div>
    );
};
