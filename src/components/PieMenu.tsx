import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SliceEditor, SliceItem } from './SliceEditor';

export interface AppearanceConfig {
    panel_opacity: number;
    panel_color: string;
    text_size: number;
    text_color: string;
    animation_type: string;
    hover_scale: string;
}

export interface MenuConfig {
    global_shortcut: string;
    appearance: AppearanceConfig;
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
    const [activeChildIndex, setActiveChildIndex] = useState<number | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editingChildIndex, setEditingChildIndex] = useState<number | null>(null);
    const [editingPos, setEditingPos] = useState<{ x: number; y: number } | null>(null);
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
                        const newConfig = configFull ? { ...configFull, items: newItems } : { global_shortcut: 'alt+space', appearance: { panel_opacity: 0.8, panel_color: '#333333', text_size: 14, text_color: '#ffffff', animation_type: 'spread', hover_scale: 'small' }, items: newItems };
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
                setActiveChildIndex(null);
                invoke('hide_menu').catch(console.error);
            });
            // Also reset on focus loss
            const l3 = listen('tauri://blur', () => {
                if (isEditorOpenRef.current) return;
                setIsVisible(false);
                setIsDragging(false);
                updateActiveIndex(null);
                setActiveChildIndex(null);
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
                setEditingIndex(null);
                setEditingChildIndex(null);
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
        if (activeIndex !== index) {
            setActiveChildIndex(null); // reset child when changing parent
        }
        setActiveIndex(index);
        hoveredIndexRef.current = index;
    };


    const size = 1000;
    const center = size / 2;
    const outerRadius = 180;
    const innerRadius = 70;

    const sliceAngle = items.length > 0 ? 360 / items.length : 360;
    const halfSlice = sliceAngle / 2; // Offset so panels CENTER on cardinal directions

    // Child ring dimensions
    const childInnerRadius = 185; // slightly closer to feel connected
    const childOuterRadius = 300;

    // We will display 3 children slots per parent as an extension of the parent slice
    const maxChildrenVisible = 3;
    const childFanAngle = sliceAngle; // Total angle span matches the parent's outer edge
    const childSliceAngle = childFanAngle / maxChildrenVisible;
    const childHalfSlice = childSliceAngle / 2;

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
        const adjusted = (angleDeg + halfSlice) % 360;
        const mainIndex = Math.floor(adjusted / sliceAngle);

        // Sub-menu logic
        const isActiveGroup = activeIndex !== null && (!items[activeIndex]?.path || (items[activeIndex]?.children?.length ?? 0) > 0);

        if (isActiveGroup) {
            // Check if mouse is in the outer child ring area
            if (distance >= innerRadius && distance <= childOuterRadius) {
                // Determine if we are hovering a child slice
                const parentAngle = activeIndex * sliceAngle;

                // Calculate angle difference relative to parent angle
                let diff = angleDeg - parentAngle;
                // Normalize diff to -180..180
                diff = (diff + 180) % 360;
                if (diff < 0) diff += 360;
                diff -= 180;

                // The fan spans from -childFanAngle/2 to +childFanAngle/2 (e.g. -90 to 90)
                const startFan = -childFanAngle / 2;
                const endFan = childFanAngle / 2;

                if (diff >= startFan && diff <= endFan) {
                    // We are inside the fan angles, figure out which child
                    const childLocalAngle = diff - startFan; // 0 to 180
                    const childIndex = Math.floor(childLocalAngle / childSliceAngle);

                    if (childIndex >= 0 && childIndex < maxChildrenVisible) { // Check against maxChildrenVisible
                        setActiveChildIndex(childIndex);
                    } else {
                        setActiveChildIndex(null);
                    }
                } else {
                    setActiveChildIndex(null);
                }
            } else if (distance < innerRadius || distance > childOuterRadius) {
                // Move back to main circle logic if within inner radii or far outside
                if (mainIndex >= 0 && mainIndex < items.length && mainIndex !== activeIndex) {
                    updateActiveIndex(mainIndex);
                }
            }
        } else {
            // Normal main menu hover
            if (mainIndex >= 0 && mainIndex < items.length) {
                updateActiveIndex(mainIndex);
            }
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (e.button !== 0) return; // Only left-click
        if (!isDragging) return;
        if (isEditorOpenRef.current) return;
        setIsDragging(false);

        if (activeIndex !== null) {
            const currentItem = configRef.current[activeIndex];

            if (activeChildIndex !== null && currentItem.children && currentItem.children.length > activeChildIndex) {
                const childItem = currentItem.children[activeChildIndex];
                // Only launch if the child actually has a path configured
                if (childItem.path) {
                    invoke('launch_app', {
                        path: childItem.path,
                        env: childItem.env
                    }).catch(console.error);
                }
            } else {
                // We clicked the parent directly. If it has a path, launch it!
                if (currentItem.path) {
                    invoke('launch_app', {
                        path: currentItem.path,
                        env: currentItem.env
                    }).catch(console.error);
                }
            }
        }

        // Hide the menu and reset state
        setIsVisible(false);
        updateActiveIndex(null);
        setActiveChildIndex(null);
        invoke('hide_menu').catch(console.error);
    };

    // Use onContextMenu to prevent the right-click menu, allowing drag with both left/right click.
    const handleContextMenu = (_e: React.MouseEvent) => _e.preventDefault();

    const handleOpenEditor = (index: number, childIdx: number | null = null) => {
        setEditingIndex(index);
        setEditingChildIndex(childIdx);

        if (childIdx !== null) {
            const parentAngle = index * sliceAngle;
            const startFanAngle = parentAngle - (childFanAngle / 2);
            const midAngle = startFanAngle + (childIdx * childSliceAngle) + childHalfSlice;

            const angleInRadians = ((midAngle - 90) * Math.PI) / 180.0;
            const outRadius = childOuterRadius + 80;
            let spawnX = center + outRadius * Math.cos(angleInRadians);
            let spawnY = center + outRadius * Math.sin(angleInRadians);

            // Keep the popup securely within bounds
            spawnX = Math.max(200, Math.min(800, spawnX));
            spawnY = Math.max(280, Math.min(720, spawnY));

            setEditingPos({ x: spawnX, y: spawnY });
            isEditorOpenRef.current = true;
            return;
        }

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
        let spawnX = center + (cx / length) * outRadius;
        let spawnY = center + (cy / length) * outRadius;

        // Keep the popup securely within bounds
        spawnX = Math.max(200, Math.min(800, spawnX));
        spawnY = Math.max(280, Math.min(720, spawnY - 40));

        setEditingPos({ x: spawnX, y: spawnY });
        isEditorOpenRef.current = true;
    };

    // Generate dynamic styles based on config
    const customStyles = React.useMemo(() => {
        if (!configFull) return {};
        const { appearance } = configFull;

        let scaleVal = 1.05; // small
        if (appearance.hover_scale === 'none') scaleVal = 1.0;
        if (appearance.hover_scale === 'medium') scaleVal = 1.10;
        if (appearance.hover_scale === 'large') scaleVal = 1.15;

        return {
            '--panel-opacity': appearance.panel_opacity,
            '--panel-color': appearance.panel_color,
            '--text-size': `${appearance.text_size}px`,
            '--text-color': appearance.text_color,
            '--hover-scale': scaleVal,
        } as React.CSSProperties;
    }, [configFull]);

    const animClass = configFull?.appearance?.animation_type ? `anim-${configFull.appearance.animation_type}` : 'anim-spread';

    return (
        <div
            className={`pie-menu-container ${isVisible ? 'visible' : ''} ${animClass}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onContextMenu={handleContextMenu}
            style={customStyles}
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
                {/* ── Sub-menu ring (Dynamic) ── */}
                {activeIndex !== null && (() => {
                    const currentItem = items[activeIndex];
                    if (!currentItem) return null;
                    const isGroup = !currentItem.path || (currentItem.children && currentItem.children.length > 0);
                    if (!isGroup) return null;

                    const parentAngle = activeIndex * sliceAngle;

                    return Array.from({ length: maxChildrenVisible }).map((_, idx) => {
                        const startFanAngle = parentAngle - (childFanAngle / 2);
                        const startAngle = startFanAngle + (idx * childSliceAngle);
                        const endAngle = startAngle + childSliceAngle - 1; // 1 degree gap for smaller slices
                        const pathD = describeArc(center, center, childInnerRadius, childOuterRadius, startAngle, endAngle);
                        const isChildActive = activeChildIndex === idx;

                        return (
                            <path
                                key={`child-${activeIndex}-${idx}`}
                                d={pathD}
                                className={`slice-path outer-slice ${isChildActive ? 'active' : ''}`}
                                onContextMenu={e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleOpenEditor(activeIndex, idx);
                                }}
                            />
                        );
                    });
                })()}
            </svg>

            {/* Sub-menu labels */}
            {activeIndex !== null && (() => {
                const currentItem = items[activeIndex];
                if (!currentItem) return null;
                const isGroup = !currentItem.path || (currentItem.children && currentItem.children.length > 0);
                if (!isGroup) return null;

                const parentAngle = activeIndex * sliceAngle;

                return Array.from({ length: maxChildrenVisible }).map((_, idx) => {
                    const child = currentItem.children?.[idx];
                    const startFanAngle = parentAngle - (childFanAngle / 2);
                    const midAngle = startFanAngle + (idx * childSliceAngle) + childHalfSlice;

                    const textRadius = childInnerRadius + (childOuterRadius - childInnerRadius) / 2;
                    const angleInRadians = ((midAngle - 90) * Math.PI) / 180.0;
                    const x = center + textRadius * Math.cos(angleInRadians);
                    const y = center + textRadius * Math.sin(angleInRadians);

                    const childName = child?.name ? child.name : "＋";
                    const isPlaceholder = !child?.name;

                    return (
                        <div
                            key={`child-label-${activeIndex}-${idx}`}
                            className="slice-content outer-label"
                            style={{ left: `${x}px`, top: `${y}px`, opacity: isPlaceholder ? 0.3 : 1 }}
                            onPointerDown={e => {
                                if (e.button === 2) e.stopPropagation();
                            }}
                            onPointerUp={e => {
                                if (e.button === 2) e.stopPropagation();
                            }}
                            onContextMenu={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleOpenEditor(activeIndex, idx);
                            }}
                        >
                            {childName}
                        </div>
                    );
                });
            })()}

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
                        {((!item.path && item.path === '') || (item.children && item.children.length > 0)) && (
                            <div style={{ fontSize: '14px', lineHeight: 1, marginTop: '2px', color: 'rgba(255,255,255,0.4)', opacity: activeIndex === index ? 1 : 0.5 }}>
                                •••
                            </div>
                        )}
                    </div>
                );
            })}

            {/* Center HUE label */}
            <div
                className="center-hole"
                onContextMenu={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    invoke('open_preferences_window').catch(console.error);
                }}
                title="Right-click for Preferences"
            >
                <div className="center-text">HUE</div>
            </div>

            {editingIndex !== null && editingPos && items[editingIndex] && (
                <SliceEditor
                    key={`editor-${editingIndex}-${editingChildIndex || 'main'}`}
                    item={editingChildIndex !== null
                        ? (items[editingIndex].children?.[editingChildIndex] || { name: '', path: '', children: [] })
                        : items[editingIndex]
                    }
                    position={editingPos}
                    onSave={(updatedItem: SliceItem) => {
                        const newItems = [...items];

                        if (editingChildIndex !== null) {
                            const parent = { ...newItems[editingIndex] };
                            const newChildren = [...(parent.children || [])];
                            // Pad children if the index is out of bounds
                            while (newChildren.length <= editingChildIndex) {
                                newChildren.push({ name: '', path: '', children: [] });
                            }
                            newChildren[editingChildIndex] = updatedItem;
                            parent.children = newChildren;
                            newItems[editingIndex] = parent;
                        } else {
                            newItems[editingIndex] = updatedItem;
                        }

                        setItems(newItems);
                        const newConfig = configFull ? { ...configFull, items: newItems } : { global_shortcut: 'alt+space', appearance: { panel_opacity: 0.8, panel_color: '#333333', text_size: 14, text_color: '#ffffff', animation_type: 'spread', hover_scale: 'small' }, items: newItems };
                        invoke('update_config', { newConfig }).catch(console.error);
                        if (configFull) setConfigFull(newConfig);
                        setEditingIndex(null);
                        setEditingChildIndex(null);
                        isEditorOpenRef.current = false;
                    }}
                    onCancel={() => {
                        setEditingIndex(null);
                        setEditingChildIndex(null);
                        isEditorOpenRef.current = false;
                    }}
                />
            )}
        </div>
    );
};
