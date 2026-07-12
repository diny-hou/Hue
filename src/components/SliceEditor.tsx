import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FolderOpen, ArrowUp, ArrowDown, GripVertical } from 'lucide-react';

export interface SliceItem {
    name: string;
    path: string;
    children: SliceItem[];
}

interface SliceEditorProps {
    item: SliceItem;
    position: { x: number; y: number };
    /** Top-level slices can own a child ring; nested editors cannot. */
    allowChildren?: boolean;
    onSave: (item: SliceItem) => void;
    onCancel: () => void;
}

type PickerTarget = 'main' | number;

function autoNameFromPath(picked: string): string {
    let auto = picked.split('\\').pop()?.split('/').pop() || '';
    if (auto.includes('.')) auto = auto.replace(/\.[^.]+$/, '');
    return auto;
}

export const SliceEditor: React.FC<SliceEditorProps> = ({
    item,
    position,
    allowChildren = true,
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

    const [childrenList, setChildrenList] = useState<SliceItem[]>(() => {
        const initialChildren = [...(item.children || [])];
        while (initialChildren.length < 8) {
            initialChildren.push({ name: '', path: '', children: [] });
        }
        return initialChildren.slice(0, 8);
    });

    const [showChildren, setShowChildren] = useState(() =>
        (item.children || []).some(c => c.name.trim() || c.path.trim())
    );

    React.useEffect(() => {
        inputRef.current?.focus({ preventScroll: true });
    }, []);

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
        if (allowChildren) {
            setChildrenList(Array.from({ length: 8 }, () => ({ name: '', path: '', children: [] })));
            setShowChildren(false);
        }
    };

    const handleSave = () => {
        const finalChildren = !allowChildren
            ? (item.children || [])
            : showChildren
                ? childrenList.map(c => ({
                    ...c,
                    name: c.name.trim(),
                    path: c.path.trim(),
                }))
                : [];

        onSave({
            ...item,
            name: name.trim(),
            path: path.trim(),
            children: finalChildren,
        });
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSave();
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

                {allowChildren && !showChildren && (
                    <button
                        type="button"
                        className="slice-editor-add-group"
                        onClick={() => setShowChildren(true)}
                    >
                        + Add sub-items
                    </button>
                )}

                {allowChildren && showChildren && (
                    <div className="slice-editor-section slice-editor-group-children">
                        <label className="slice-editor-label">Group Items (8 Slots)</label>
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
                <button className="slice-editor-save" onClick={handleSave}>Save</button>
                <button className="slice-editor-clear" onClick={handleClear}>Clear</button>
                <button className="slice-editor-cancel" onClick={onCancel}>Cancel</button>
            </div>
        </div>
    );
};
