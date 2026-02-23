import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SliceEditor, SliceItem } from './SliceEditor';
import { Preferences } from './Preferences';

export interface MenuConfig {
    global_shortcut: string;
    items: MenuItem[];
}

// Re-export type alias for internal use
type MenuItem = SliceItem;

const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
    const angleInRadians = (angleInDegrees * Math.PI) / 180.0;
    return {
        x: centerX + radius * Math.cos(angleInRadians),
        y: centerY + radius * Math.sin(angleInRadians)
    };
};

const describeArc = (x: number, y: number, innerRadius: number, outerRadius: number, startAngle: number, endAngle: number) => {
    const startOuter = polarToCartesian(x, y, outerRadius, endAngle);
    const endOuter = polarToCartesian(x, y, outerRadius, startAngle);
    const startInner = polarToCartesian(x, y, innerRadius, endAngle);
    const endInner = polarToCartesian(x, y, innerRadius, startAngle);

    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

    return [
        "M", startOuter.x, startOuter.y,
        "A", outerRadius, outerRadius, 0, largeArcFlag, 0, endOuter.x, endOuter.y,
        "L", endInner.x, endInner.y,
        "A", innerRadius, innerRadius, 0, largeArcFlag, 1, startInner.x, startInner.y,
        "Z"
    ].join(" ");
};

export const PieMenu: React.FC = () => {
    const [items, setItems] = useState<MenuItem[]>([]);
    const [configFull, setConfigFull] = useState<MenuConfig | null>(null);
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editingPos, setEditingPos] = useState<{ x: number; y: number } | null>(null);
    const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
    const isEditorOpenRef = React.useRef(false);
    const hoveredIndexRef = React.useRef<number | null>(null);

    useEffect(() => {
        invoke<MenuConfig>('get_config')
            .then(config => {
                setItems(config.items);
                setConfigFull(config);
            })
            .catch(console.error);

        let unlistenDrag: () => void;
        let unlistenFile: () => void;

        import('@tauri-apps/api/event').then(({ listen }) => {
            const handleDrop = (event: any) => {
                const paths = event.payload?.paths || event.payload;
                if (Array.isArray(paths) && paths.length > 0 && hoveredIndexRef.current !== null) {
                    setItems(prev => {
                        const newItems = [...prev];
                        const path = paths[0];
                        let name = path.split('\\').pop()?.split('/').pop() || 'App';
                        if (name.endsWith('.exe')) name = name.substring(0, name.length - 4);
                        newItems[hoveredIndexRef.current!] = { name, path, children: [] };
                        const newConfig = configFull ? { ...configFull, items: newItems } : { global_shortcut: 'alt+space', items: newItems };
                        invoke('update_config', { newConfig }).catch(console.error);
                        if (configFull) setConfigFull({ ...configFull, items: newItems });
                        return newItems;
                    });
                }
            };

            listen('tauri://drag-drop', handleDrop).then(f => unlistenDrag = f as any);
            listen('tauri://file-drop', handleDrop).then(f => unlistenFile = f as any);
        });

        const unlistenVisibility = import('@tauri-apps/api/event').then(({ listen }) => {
            const l1 = listen('menu-show', () => {
                setIsVisible(true);
            });
            const l2 = listen('menu-hide', () => {
                if (isEditorOpenRef.current) return;
                setIsVisible(false);
                setIsDragging(false);
                updateActiveIndex(null);
                invoke('hide_menu').catch(console.error);
            });
            // Also reset on focus loss
            const l3 = listen('tauri://blur', () => {
                if (isEditorOpenRef.current) return;
                setIsVisible(false);
                setIsDragging(false);
                updateActiveIndex(null);
            });
            const l4 = listen('reload-config', () => {
                invoke<MenuConfig>('get_config')
                    .then(config => {
                        setItems(config.items);
                        setConfigFull(config);
                    })
                    .catch(console.error);
            });
            const l5 = listen('editor-closed', () => {
                isEditorOpenRef.current = false;
            });
            return Promise.all([l1, l2, l3, l4, l5]);
        });

        return () => {
            if (unlistenDrag) unlistenDrag();
            if (unlistenFile) unlistenFile();
            unlistenVisibility.then(listeners => listeners.forEach(un => un()));
        };
    }, []);

    // Keep items in a ref so the hotkey listener can access the latest array without re-binding
    const configRef = React.useRef<MenuItem[]>([]);
    useEffect(() => {
        configRef.current = items;
    }, [items]);

    // Update the activeIndex and hover proxy together
    const updateActiveIndex = (index: number | null) => {
        setActiveIndex(index);
        hoveredIndexRef.current = index;
    };


    const size = 800;
    const center = size / 2;
    const outerRadius = 180;
    const innerRadius = 70;

    // Outer ring dimensions
    const outerRingInner = 190;
    const outerRingOuter = 300;
    const outerSliceCount = 16;
    const outerSliceAngle = 360 / outerSliceCount;
    const outerHalfSlice = outerSliceAngle / 2;

    const sliceAngle = 360 / items.length;
    const halfSlice = sliceAngle / 2; // Offset so panels CENTER on cardinal directions

    const handlePointerDown = (e: React.PointerEvent) => {
        if (e.button !== 0) return; // Only left-click
        if (isEditorOpenRef.current) return;
        setIsDragging(true);
        handlePointerMove(e); // Initialize angle calculation immediately if dragging starts off-center
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDragging) {
            // If we are just moving the mouse without dragging in a Marking Menu,
            // we typically don't highlight anything.
            return;
        }

        const rect = e.currentTarget.getBoundingClientRect();
        // Mouse position relative to the center of the 400x400 container
        const dx = e.clientX - rect.left - center;
        const dy = e.clientY - rect.top - center;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Intentionally require a minimum movement radius (e.g. 40px) to prevent accidental selection
        if (distance < 40) {
            updateActiveIndex(null);
            return;
        }

        // SVG rotates -90 degrees, so visually top is angle 0.
        // atan2 is standard math (0 is right, 90 is bottom).
        // Let's calculate the angle in degrees relative to the visual layout.
        // dx, dy -> atan2(dy, dx) -> radians. 
        // Then we subtract 90 deg offset, and wrap to 0-360.
        let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        // Adjust for the visual -90deg rotation in CSS
        angleDeg = (angleDeg + 90 + 360) % 360;

        // Determine which slice this angle falls into
        // Add halfSlice offset because slices are centered on cardinal directions
        const adjusted = (angleDeg + halfSlice) % 360;
        const index = Math.floor(adjusted / sliceAngle);
        if (index >= 0 && index < items.length) {
            updateActiveIndex(index);
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (e.button !== 0) return; // Only left-click
        if (!isDragging) return;
        if (isEditorOpenRef.current) return;
        setIsDragging(false);

        if (activeIndex !== null) {
            const currentItem = configRef.current[activeIndex];
            invoke('launch_app', {
                path: currentItem.path,
                env: currentItem.env
            }).catch(console.error);
        }

        // Hide the menu and reset state
        setIsVisible(false);
        updateActiveIndex(null);
        invoke('hide_menu').catch(console.error);
    };

    // Use onContextMenu to prevent the right-click menu, allowing drag with both left/right click.
    const handleContextMenu = (_e: React.MouseEvent) => _e.preventDefault();

    const handleOpenEditor = (index: number) => {
        // midAngle is the visual center of the slice (on a cardinal direction)
        const midAngle = index * sliceAngle;
        const textRadius = innerRadius + (outerRadius - innerRadius) / 2;
        // Transform polar to cartesian
        const angleInRadians = ((midAngle - 90) * Math.PI) / 180.0;
        const x = center + textRadius * Math.cos(angleInRadians);
        const y = center + textRadius * Math.sin(angleInRadians);

        const cx = x - center;
        const cy = y - center;
        const length = Math.sqrt(cx * cx + cy * cy);

        // Push the spawn point outward
        const outRadius = outerRadius + 80;
        const spawnX = center + (cx / length) * outRadius;
        const spawnY = center + (cy / length) * outRadius;

        setEditingPos({ x: spawnX, y: Math.max(0, spawnY - 60) });
        setEditingIndex(index);
        isEditorOpenRef.current = true;
    };

    return (
        <div
            className={`pie-menu-container ${isVisible ? 'visible' : ''}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onContextMenu={handleContextMenu}
        >
            <svg className="pie-svg" viewBox={`0 0 ${size} ${size}`}>
                <defs>
                    <filter id="glass-blur">
                        <feGaussianBlur stdDeviation="5" />
                    </filter>
                </defs>
                {items.map((_item, index) => {
                    const startAngle = index * sliceAngle - halfSlice;
                    // small gap between slices for aesthetics
                    const endAngle = startAngle + sliceAngle - 2;

                    const pathD = describeArc(center, center, innerRadius, outerRadius, startAngle, endAngle);
                    const isActive = activeIndex === index;

                    return (
                        <path
                            key={index}
                            d={pathD}
                            className={`slice-path ${isActive ? 'active' : ''}`}
                            onContextMenu={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleOpenEditor(index);
                            }}
                        />
                    );
                })}
                {/* ── Outer 16-slice ring ── */}
                {Array.from({ length: outerSliceCount }).map((_, index) => {
                    const startAngle = index * outerSliceAngle - outerHalfSlice;
                    const endAngle = startAngle + outerSliceAngle - 2;
                    const pathD = describeArc(center, center, outerRingInner, outerRingOuter, startAngle, endAngle);
                    return (
                        <path
                            key={`outer-${index}`}
                            d={pathD}
                            className="slice-path outer-slice"
                        />
                    );
                })}
            </svg>

            {/* Outer ring labels */}
            {Array.from({ length: outerSliceCount }).map((_, index) => {
                const midAngle = index * outerSliceAngle;
                const textRadius = outerRingInner + (outerRingOuter - outerRingInner) / 2;
                const angleInRadians = ((midAngle - 90) * Math.PI) / 180.0;
                const x = center + textRadius * Math.cos(angleInRadians);
                const y = center + textRadius * Math.sin(angleInRadians);
                return (
                    <div
                        key={`outer-label-${index}`}
                        className="slice-content outer-label"
                        style={{ left: `${x}px`, top: `${y}px` }}
                    >
                        {index + 1}
                    </div>
                );
            })}

            {/* HTML overlay for text/icons (avoids SVG text limitations and allows better styling) */}
            {items.map((item, index) => {
                // midAngle is the visual center of the slice (on a cardinal direction)
                const midAngle = index * sliceAngle;
                const textRadius = innerRadius + (outerRadius - innerRadius) / 2;
                // Transform polar to cartesian for HTML positioning
                // Subtract 90 degrees because SVG rotate(-90deg) puts 0 at the top
                const angleInRadians = ((midAngle - 90) * Math.PI) / 180.0;
                const x = center + textRadius * Math.cos(angleInRadians);
                const y = center + textRadius * Math.sin(angleInRadians);

                return (
                    <div
                        key={index}
                        className="slice-content"
                        style={{ left: `${x}px`, top: `${y}px` }}
                        onPointerDown={e => {
                            if (e.button === 2) e.stopPropagation();
                        }}
                        onPointerUp={e => {
                            if (e.button === 2) e.stopPropagation();
                        }}
                        onContextMenu={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleOpenEditor(index);
                        }}
                    >
                        {item.name}
                    </div>
                );
            })}

            {/* Center HUE label */}
            <div
                className="center-hole"
                onContextMenu={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsPreferencesOpen(true);
                    isEditorOpenRef.current = true;
                }}
                title="Right-click for Preferences"
            >
                <div className="center-text">HUE</div>
            </div>

            {editingIndex !== null && editingPos && items[editingIndex] && (
                <SliceEditor
                    key={editingIndex}
                    item={items[editingIndex]}
                    position={editingPos}
                    onSave={(updatedItem: SliceItem) => {
                        const newItems = [...items];
                        newItems[editingIndex] = updatedItem;
                        setItems(newItems);
                        const newConfig = configFull ? { ...configFull, items: newItems } : { global_shortcut: 'alt+space', items: newItems };
                        invoke('update_config', { newConfig }).catch(console.error);
                        if (configFull) setConfigFull(newConfig);
                        setEditingIndex(null);
                        isEditorOpenRef.current = false;
                    }}
                    onCancel={() => {
                        setEditingIndex(null);
                        isEditorOpenRef.current = false;
                    }}
                />
            )}

            {isPreferencesOpen && configFull && (
                <Preferences
                    config={configFull}
                    onClose={() => {
                        setIsPreferencesOpen(false);
                        isEditorOpenRef.current = false;
                    }}
                    onSaved={() => {
                        // Reload state to get new config values
                        invoke<MenuConfig>('get_config').then(c => setConfigFull(c)).catch(console.error);
                        setIsPreferencesOpen(false);
                        isEditorOpenRef.current = false;
                    }}
                />
            )}
        </div>
    );
};
