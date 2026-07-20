import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FolderOpen, ArrowUp, ArrowDown, GripVertical } from 'lucide-react';

export interface AutoConfig {
    enabled: boolean;
    folder: string;
    tag: string;
}

export interface SliceItem {
    name: string;
    path: string;
    children: SliceItem[];
    auto?: AutoConfig | null;
}

interface SliceEditorProps {
    item: SliceItem;
    position: { x: number; y: number };
    /** When false, nested children cannot be edited (e.g. grandchild depth). */
    allowChildren?: boolean;
    /** When false, Auto toggle is hidden (e.g. parent already uses Auto). */
    allowAuto?: boolean;
    addChildrenLabel?: string;
    groupChildrenLabel?: string;
    onSave: (item: SliceItem) => void;
    onCancel: () => void;
}

type PickerTarget = 'main' | 'auto' | number;

type AutoEntry = { name: string; path: string };

function autoNameFromPath(picked: string): string {
    let auto = picked.split('\\').pop()?.split('/').pop() || '';
    if (auto.includes('.')) auto = auto.replace(/\.[^.]+$/, '');
    return auto;
}

export const SliceEditor: React.FC<SliceEditorProps> = ({
    item,
    position,
    allowChildren = true,
    allowAuto = true,
    addChildrenLabel = '+ Add sub-items',
    groupChildrenLabel = 'Group Items (8 Slots)',
    onSave,
    onCancel,
}) => {
    const [name, setName] = useState(item.name);
    const [path, setPath] = useState(item.path);
    const [pos, setPos] = useState({ x: position.x, y: position.y });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [pickerMenu, setPickerMenu] = useState<PickerTarget | null>(null);
    const [loading, setLoading] = useState(false);
    const inputRef = React.useRef<HTMLInputElement>(null);

    const autoAllowed = allowChildren && allowAuto;
    const [autoEnabled, setAutoEnabled] = useState(!!item.auto?.enabled && allowAuto);
    const [autoFolder, setAutoFolder] = useState(item.auto?.folder ?? item.path ?? '');
    const [autoTag, setAutoTag] = useState(item.auto?.tag ?? '');
    const [autoPreview, setAutoPreview] = useState<AutoEntry[]>([]);
    const [autoPreviewError, setAutoPreviewError] = useState<string | null>(null);

    const [childrenList, setChildrenList] = useState<SliceItem[]>(() => {
        const initialChildren = [...(item.children || [])];
        while (initialChildren.length < 8) {
            initialChildren.push({ name: '', path: '', children: [] });
        }
        return initialChildren.slice(0, 8);
    });

    const [showChildren, setShowChildren] = useState(() =>
        !item.auto?.enabled && (item.children || []).some(c => c.name.trim() || c.path.trim())
    );

    const refreshAutoPreview = React.useCallback(async (folder: string, tag: string) => {
        const f = folder.trim();
        if (!f) {
            setAutoPreview([]);
            setAutoPreviewError(null);
            return;
        }
        try {
            const entries = await invoke<AutoEntry[]>('list_auto_entries', { folder: f, tag });
            setAutoPreview(entries);
            setAutoPreviewError(null);
        } catch (e) {
            setAutoPreview([]);
            setAutoPreviewError(String(e));
        }
    }, []);

    React.useEffect(() => {
        inputRef.current?.focus({ preventScroll: true });
    }, []);

    React.useEffect(() => {
        if (!autoEnabled || !autoAllowed) return;
        void refreshAutoPreview(autoFolder, autoTag);
    }, [autoEnabled, autoFolder, autoTag, autoAllowed, refreshAutoPreview]);

    React.useEffect(() => {
        if (!allowAuto && autoEnabled) {
            setAutoEnabled(false);
        }
    }, [allowAuto, autoEnabled]);

    React.useEffect(() => {
        if (pickerMenu === null) return;
        const close = () => setPickerMenu(null);
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
        };
        window.addEventListener('pointerdown', close);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('pointerdown', close);
            window.removeEventListener('keydown', onKey);
        };
    }, [pickerMenu]);

    const applyPickedPath = (picked: string, target: PickerTarget) => {
        const auto = autoNameFromPath(picked);
        if (target === 'main') {
            setPath(picked);
            if (auto) setName(auto);
            return;
        }
        if (target === 'auto') {
            setAutoFolder(picked);
            return;
        }
        const newChildren = [...childrenList];
        newChildren[target] = {
            ...newChildren[target],
            path: picked,
            name: auto || newChildren[target].name,
        };
        setChildrenList(newChildren);
    };

    const pick = async (kind: 'file' | 'folder', target: PickerTarget) => {
        setPickerMenu(null);
        setLoading(true);
        try {
            await invoke('set_native_dialog_open', { open: true });
            const command = kind === 'file' ? 'pick_file' : 'pick_folder';
            const picked = await invoke<string | null>(command);
            if (picked) applyPickedPath(picked, target);
        } finally {
            await invoke('set_native_dialog_open', { open: false }).catch(() => {});
            setLoading(false);
        }
    };

    const handleChildChange = (idx: number, field: 'name' | 'path', value: string) => {
        const newChildren = [...childrenList];
        newChildren[idx] = { ...newChildren[idx], [field]: value };
        setChildrenList(newChildren);
    };

    const handleChildMoveUp = (idx: number) => {
        if (idx === 0) return;
        const newChildren = [...childrenList];
        const temp = newChildren[idx];
        newChildren[idx] = newChildren[idx - 1];
        newChildren[idx - 1] = temp;
        setChildrenList(newChildren);
    };

    const handleChildMoveDown = (idx: number) => {
        if (idx === childrenList.length - 1) return;
        const newChildren = [...childrenList];
        const temp = newChildren[idx];
        newChildren[idx] = newChildren[idx + 1];
        newChildren[idx + 1] = temp;
        setChildrenList(newChildren);
    };

    const handleItemPointerDown = (e: React.PointerEvent<HTMLDivElement>, idx: number) => {
        if (e.button === 0 && (e.target as HTMLElement).closest('.slice-editor-drag-handle')) {
            e.preventDefault();
            setDragIndex(idx);
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }
    };

    const handleItemPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (dragIndex === null) return;
        const elements = document.elementsFromPoint(e.clientX, e.clientY);
        const hoveredRow = elements.find(el => el.classList.contains('slice-editor-child-row'));
        if (hoveredRow) {
            const hoverIndexStr = hoveredRow.getAttribute('data-index');
            if (hoverIndexStr) {
                const hoverIndex = parseInt(hoverIndexStr, 10);
                if (hoverIndex !== dragIndex) {
                    const newChildren = [...childrenList];
                    const temp = newChildren[dragIndex];
                    newChildren[dragIndex] = newChildren[hoverIndex];
                    newChildren[hoverIndex] = temp;
                    setChildrenList(newChildren);
                    setDragIndex(hoverIndex);
                }
            }
        }
    };

    const handleItemPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (dragIndex !== null) {
            setDragIndex(null);
            (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        }
    };

    const handleClear = () => {
        setName('');
        setPath('');
        setAutoEnabled(false);
        setAutoFolder('');
        setAutoTag('');
        setAutoPreview([]);
        if (allowChildren) {
            setChildrenList(Array.from({ length: 8 }, () => ({ name: '', path: '', children: [] })));
            setShowChildren(false);
        }
    };

    const handleSave = async () => {
        let finalChildren: SliceItem[] = !allowChildren
            ? (item.children || [])
            : showChildren && !autoEnabled
                ? childrenList.map(c => ({
                    ...c,
                    name: c.name.trim(),
                    path: c.path.trim(),
                }))
                : [];

        const autoConfig: AutoConfig | null = autoAllowed && autoEnabled
            ? {
                enabled: true,
                folder: autoFolder.trim() || path.trim(),
                tag: autoTag.trim(),
            }
            : null;

        if (autoConfig?.enabled) {
            try {
                finalChildren = await invoke<AutoEntry[]>('list_auto_entries', {
                    folder: autoConfig.folder,
                    tag: autoConfig.tag,
                }).then(entries => entries.map(e => ({
                    name: e.name,
                    path: e.path,
                    children: [] as SliceItem[],
                })));
            } catch (e) {
                console.error('[SliceEditor] auto sync failed:', e);
                alert(`Auto sync failed: ${e}`);
                return;
            }
        }

        onSave({
            ...item,
            name: name.trim(),
            path: path.trim(),
            children: finalChildren,
            auto: autoConfig,
        });
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') void handleSave();
        if (e.key === 'Escape') onCancel();
        e.stopPropagation();
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        setIsDragging(true);
        setDragOffset({
            x: e.clientX - pos.x,
            y: e.clientY - pos.y,
        });
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        e.stopPropagation();
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDragging) return;
        setPos({
            x: e.clientX - dragOffset.x,
            y: e.clientY - dragOffset.y,
        });
        e.stopPropagation();
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        setIsDragging(false);
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        e.stopPropagation();
    };

    const renderPickerMenu = (target: PickerTarget) => (
        <div
            className="slice-editor-picker-menu"
            onPointerDown={e => e.stopPropagation()}
        >
            <button type="button" onClick={() => pick('file', target)} disabled={loading}>
                File
            </button>
            <button type="button" onClick={() => pick('folder', target)} disabled={loading}>
                Folder
            </button>
        </div>
    );

    return (
        <div
            className="slice-editor"
            style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
            onPointerDown={e => e.stopPropagation()}
            onPointerUp={e => e.stopPropagation()}
            onContextMenu={e => e.preventDefault()}
            onKeyDown={handleKeyDown}
        >
            <div
                className="slice-editor-title"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
            >
                Edit Panel
            </div>

            <label className="slice-editor-label">Label</label>
            <div className="slice-editor-path-row slice-editor-label-row">
                <input
                    ref={inputRef}
                    className="slice-editor-input"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="App name"
                />
                <div className="slice-editor-browse-wrap">
                    <button
                        className="slice-editor-browse"
                        onClick={e => {
                            e.stopPropagation();
                            setPickerMenu(pickerMenu === 'main' ? null : 'main');
                        }}
                        disabled={loading}
                        title="Browse…"
                    >
                        {loading && pickerMenu === null ? '…' : <FolderOpen size={16} />}
                    </button>
                    {pickerMenu === 'main' && renderPickerMenu('main')}
                </div>
            </div>

            <div className="slice-editor-body">
                <div className="slice-editor-section">
                    <label className="slice-editor-label">Path / Command</label>
                    <input
                        className="slice-editor-input"
                        type="text"
                        value={path}
                        onChange={e => setPath(e.target.value)}
                        placeholder="Path or command"
                    />
                </div>

                {allowChildren && !allowAuto && (
                    <div className="slice-editor-section slice-editor-auto-section">
                        <small className="slice-editor-auto-hint">
                            Parent uses Auto — this slot is filled from the parent folder. Nested Auto is disabled here.
                        </small>
                    </div>
                )}

                {autoAllowed && (
                    <div className="slice-editor-section slice-editor-auto-section">
                        <div className="slice-editor-auto-header">
                            <label className="slice-editor-label">Auto (folder sync)</label>
                            <label className="toggle-switch slice-editor-auto-toggle">
                                <input
                                    type="checkbox"
                                    checked={autoEnabled}
                                    onChange={e => {
                                        setAutoEnabled(e.target.checked);
                                        if (e.target.checked) setShowChildren(false);
                                    }}
                                />
                                <span className="slider round" />
                            </label>
                        </div>
                        {autoEnabled && (
                            <div className="slice-editor-auto-fields">
                                <label className="slice-editor-label">Source folder</label>
                                <div className="slice-editor-path-row">
                                    <input
                                        className="slice-editor-input"
                                        type="text"
                                        value={autoFolder}
                                        onChange={e => setAutoFolder(e.target.value)}
                                        placeholder="Folder to scan"
                                    />
                                    <div className="slice-editor-browse-wrap">
                                        <button
                                            className="slice-editor-browse"
                                            onClick={e => {
                                                e.stopPropagation();
                                                void pick('folder', 'auto');
                                            }}
                                            disabled={loading}
                                            title="Pick folder"
                                        >
                                            <FolderOpen size={16} />
                                        </button>
                                    </div>
                                </div>
                                <label className="slice-editor-label">Filename tag (optional)</label>
                                <input
                                    className="slice-editor-input"
                                    type="text"
                                    value={autoTag}
                                    onChange={e => setAutoTag(e.target.value)}
                                    placeholder="Leave empty = all files in this folder"
                                />
                                <small className="slice-editor-auto-hint">
                                    Empty tag lists every file in the folder (not recursive — subfolders ignored).
                                    With a tag, only filenames containing that text are included.
                                </small>
                                <div className="slice-editor-auto-preview">
                                    {autoPreviewError ? (
                                        <span className="slice-editor-auto-preview-error">{autoPreviewError}</span>
                                    ) : (
                                        <>
                                            <span className="slice-editor-auto-preview-count">
                                                {autoPreview.length} file{autoPreview.length === 1 ? '' : 's'}
                                                {!autoTag.trim() ? ' · all files' : ` · tag “${autoTag.trim()}”`}
                                                {autoPreview.length > 8 ? ' · spiral when >8' : ''}
                                            </span>
                                            {autoPreview.slice(0, 5).map((entry, i) => (
                                                <span key={`${entry.path}-${i}`} className="slice-editor-auto-preview-item">{entry.name}</span>
                                            ))}
                                            {autoPreview.length > 5 && (
                                                <span className="slice-editor-auto-preview-more">+{autoPreview.length - 5} more</span>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {allowChildren && !autoEnabled && !showChildren && (
                    <button
                        type="button"
                        className="slice-editor-add-group"
                        onClick={() => setShowChildren(true)}
                    >
                        {addChildrenLabel}
                    </button>
                )}

                {allowChildren && !autoEnabled && showChildren && (
                    <div className="slice-editor-section slice-editor-group-children">
                        <label className="slice-editor-label">{groupChildrenLabel}</label>
                        <div className="slice-editor-children-list">
                            {childrenList.map((child, idx) => (
                                <div
                                    key={idx}
                                    className={`slice-editor-child-row ${dragIndex === idx ? 'dragging' : ''}`}
                                    data-index={idx}
                                    onPointerDown={e => handleItemPointerDown(e, idx)}
                                    onPointerMove={handleItemPointerMove}
                                    onPointerUp={handleItemPointerUp}
                                    onPointerCancel={handleItemPointerUp}
                                >
                                    <div className="slice-editor-drag-handle" title="Drag to reorder">
                                        <GripVertical size={14} />
                                    </div>
                                    <div className="child-idx-controls">
                                        <div className="child-idx-arrows">
                                            <button
                                                className="slice-editor-arrow-btn"
                                                onClick={() => handleChildMoveUp(idx)}
                                                disabled={idx === 0}
                                                title="Move Up"
                                            >
                                                <ArrowUp size={10} />
                                            </button>
                                            <button
                                                className="slice-editor-arrow-btn"
                                                onClick={() => handleChildMoveDown(idx)}
                                                disabled={idx === childrenList.length - 1}
                                                title="Move Down"
                                            >
                                                <ArrowDown size={10} />
                                            </button>
                                        </div>
                                        <span className="child-idx">{idx + 1}.</span>
                                    </div>
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
                                            <div className="slice-editor-browse-wrap">
                                                <button
                                                    className="slice-editor-browse"
                                                    onClick={e => {
                                                        e.stopPropagation();
                                                        setPickerMenu(pickerMenu === idx ? null : idx);
                                                    }}
                                                    disabled={loading}
                                                    title="Browse…"
                                                >
                                                    <FolderOpen size={16} />
                                                </button>
                                                {pickerMenu === idx && renderPickerMenu(idx)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="slice-editor-actions">
                <button className="slice-editor-save" onClick={() => void handleSave()}>Save</button>
                <button className="slice-editor-clear" onClick={handleClear}>Clear</button>
                <button className="slice-editor-cancel" onClick={onCancel}>Cancel</button>
            </div>
        </div>
    );
};
