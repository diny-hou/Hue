import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface SliceItem {
    name: string;
    path: string;
    env?: Record<string, string>;
    children: SliceItem[];
}

interface SliceEditorProps {
    item: SliceItem;
    position: { x: number; y: number };
    onSave: (item: SliceItem) => void;
    onCancel: () => void;
}

export const SliceEditor: React.FC<SliceEditorProps> = ({ item, position, onSave, onCancel }) => {
    const [name, setName] = useState(item.name);
    // If it's a group, path should be empty and children can exist. We let user toggle.
    // If there is no path and it has children, it's definitely a group.
    // If it has BOTH, it's a hybrid.
    const isInitialHybrid = !!item.path && item.children && item.children.length > 0;
    const isInitialGroup = !item.path && item.children && item.children.length > 0;
    const [panelType, setPanelType] = useState<'app' | 'group' | 'hybrid'>(
        isInitialHybrid ? 'hybrid' : (isInitialGroup ? 'group' : 'app')
    );

    const [childrenList, setChildrenList] = useState<SliceItem[]>(() => {
        const initialChildren = [...(item.children || [])];
        while (initialChildren.length < 8) {
            initialChildren.push({ name: '', path: '', children: [] });
        }
        return initialChildren.slice(0, 8);
    });

    const [path, setPath] = useState(item.path);
    const [envList, setEnvList] = useState<{ key: string; value: string }[]>(
        item.env ? Object.entries(item.env).map(([key, value]) => ({ key, value })) : []
    );
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
                let auto = picked.split('\\').pop()?.split('/').pop() || '';
                if (auto.includes('.')) auto = auto.replace(/\.[^.]+$/, '');
                if (auto) setName(auto);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleBrowseFolder = async () => {
        setLoading(true);
        try {
            const picked = await invoke<string | null>('pick_folder');
            if (picked) {
                setPath(picked);
                const auto = picked.split('\\').pop()?.split('/').pop() || '';
                if (auto) setName(auto);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleChildBrowse = async (idx: number) => {
        setLoading(true);
        try {
            const picked = await invoke<string | null>('pick_file');
            if (picked) {
                const newChildren = [...childrenList];
                newChildren[idx].path = picked;
                let auto = picked.split('\\').pop()?.split('/').pop() || '';
                if (auto.includes('.')) auto = auto.replace(/\.[^.]+$/, '');
                if (auto) newChildren[idx].name = auto;
                setChildrenList(newChildren);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleChildBrowseFolder = async (idx: number) => {
        setLoading(true);
        try {
            const picked = await invoke<string | null>('pick_folder');
            if (picked) {
                const newChildren = [...childrenList];
                newChildren[idx].path = picked;
                const auto = picked.split('\\').pop()?.split('/').pop() || '';
                if (auto) newChildren[idx].name = auto;
                setChildrenList(newChildren);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleChildChange = (idx: number, field: 'name' | 'path', value: string) => {
        const newChildren = [...childrenList];
        newChildren[idx] = { ...newChildren[idx], [field]: value };
        setChildrenList(newChildren);
    };

    const handleClear = () => {
        setName('');
        setPath('');
        setEnvList([]);
    };

    const handleSave = () => {
        let envMap: Record<string, string> | undefined = undefined;
        const validEnvs = envList.filter(e => e.key.trim() !== '');
        if (validEnvs.length > 0) {
            envMap = {};
            validEnvs.forEach(e => {
                envMap![e.key.trim()] = e.value.trim();
            });
        }

        const isGroupOnly = panelType === 'group';
        const isHybrid = panelType === 'hybrid';

        let finalChildren = item.children || [];
        if (isGroupOnly || isHybrid) {
            finalChildren = childrenList.map(c => ({
                ...c,
                name: c.name.trim(),
                path: c.path.trim(),
            }));
        }

        onSave({
            ...item,
            name: name.trim(),
            path: isGroupOnly ? '' : path.trim(),
            env: isGroupOnly ? undefined : envMap,
            children: finalChildren
        });
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSave();
        if (e.key === 'Escape') onCancel();
        e.stopPropagation(); // prevent pie menu events
    };

    const style: React.CSSProperties = {
        left: `${position.x}px`,
        top: `${position.y}px`
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
                placeholder={panelType === 'group' ? "Group Name" : "App name"}
            />

            <div className="slice-editor-type-toggle">
                <button
                    className={`type-btn ${panelType === 'app' ? 'active' : ''}`}
                    onClick={() => setPanelType('app')}
                >
                    Application
                </button>
                <button
                    className={`type-btn ${panelType === 'group' ? 'active' : ''}`}
                    onClick={() => setPanelType('group')}
                >
                    Folder
                </button>
                <button
                    className={`type-btn ${panelType === 'hybrid' ? 'active' : ''}`}
                    onClick={() => setPanelType('hybrid')}
                >
                    App + Folder
                </button>
            </div>

            <div className={`slice-editor-body ${panelType === 'hybrid' ? 'hybrid-layout' : ''}`}>
                {(panelType === 'app' || panelType === 'hybrid') && (
                    <div className="slice-editor-section">
                        <label className="slice-editor-label">Path / Command</label>
                        <div className="slice-editor-path-row">
                            <input
                                className="slice-editor-input"
                                type="text"
                                value={path}
                                onChange={e => setPath(e.target.value)}
                                placeholder="Path or folder"
                            />
                            <button
                                className="slice-editor-browse"
                                onClick={handleBrowse}
                                disabled={loading}
                                title="Browse file…"
                            >
                                {loading ? '…' : '📄'}
                            </button>
                            <button
                                className="slice-editor-browse"
                                onClick={handleBrowseFolder}
                                disabled={loading}
                                title="Browse folder…"
                            >
                                {loading ? '…' : '📁'}
                            </button>
                        </div>

                        <div className="slice-editor-env-header">
                            <label className="slice-editor-label">Environment Variables</label>
                            <button
                                className="slice-editor-add-env"
                                onClick={() => setEnvList([...envList, { key: '', value: '' }])}
                                title="Add Environment Variable"
                            >
                                +
                            </button>
                        </div>
                        <div className="slice-editor-env-list">
                            {envList.map((envItem, idx) => (
                                <div key={idx} className="slice-editor-env-row">
                                    <input
                                        className="slice-editor-input env-key"
                                        type="text"
                                        placeholder="KEY"
                                        value={envItem.key}
                                        onChange={e => {
                                            const newList = [...envList];
                                            newList[idx].key = e.target.value.toUpperCase();
                                            setEnvList(newList);
                                        }}
                                    />
                                    <span className="env-equals">=</span>
                                    <input
                                        className="slice-editor-input env-val"
                                        type="text"
                                        placeholder="Value"
                                        value={envItem.value}
                                        onChange={e => {
                                            const newList = [...envList];
                                            newList[idx].value = e.target.value;
                                            setEnvList(newList);
                                        }}
                                    />
                                    <button
                                        className="slice-editor-remove-env"
                                        onClick={() => {
                                            const newList = [...envList];
                                            newList.splice(idx, 1);
                                            setEnvList(newList);
                                        }}
                                        title="Remove"
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {(panelType === 'group' || panelType === 'hybrid') && (
                    <div className="slice-editor-section slice-editor-group-children">
                        <label className="slice-editor-label">Group Items (8 Slots)</label>
                        <div className="slice-editor-children-list">
                            {childrenList.map((child, idx) => (
                                <div key={idx} className="slice-editor-child-row">
                                    <span className="child-idx">{idx + 1}.</span>
                                    <div className="child-inputs">
                                        <input
                                            className="slice-editor-input"
                                            type="text"
                                            placeholder="Name"
                                            value={child.name}
                                            onChange={e => handleChildChange(idx, 'name', e.target.value)}
                                        />
                                        <div className="slice-editor-path-row">
                                            <input
                                                className="slice-editor-input"
                                                type="text"
                                                placeholder="C:\..."
                                                value={child.path}
                                                onChange={e => handleChildChange(idx, 'path', e.target.value)}
                                            />
                                            <button
                                                className="slice-editor-browse"
                                                onClick={() => handleChildBrowse(idx)}
                                                disabled={loading}
                                                title="Browse file…"
                                            >
                                                {loading ? '…' : '📄'}
                                            </button>
                                            <button
                                                className="slice-editor-browse"
                                                onClick={() => handleChildBrowseFolder(idx)}
                                                disabled={loading}
                                                title="Browse folder…"
                                            >
                                                {loading ? '…' : '📁'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="slice-editor-actions">
                <button className="slice-editor-save" onClick={handleSave}>Save</button>
                <button className="slice-editor-clear" onClick={handleClear}>Clear</button>
                <button className="slice-editor-cancel" onClick={onCancel}>Cancel</button>
            </div>
        </div>
    );
};
