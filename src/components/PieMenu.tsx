import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { SliceEditor, SliceItem } from './SliceEditor';

export interface AppearanceConfig {
    panel_opacity: number;
    panel_color: string;
    text_size: number;
    text_color: string;
    animation_type: string;
    hover_scale: string;
    hover_animation?: string;
    hover_opacity?: number;
    sub_panel_opacity?: number;
    drag_opacity?: number;
    sub_panel_hover_opacity?: number;
    sub_panel_text_size?: number;
    sub_panel_text_color?: string;
    gesture_path_debug?: boolean;
    gesture_path_capture?: boolean;
    /** Below: child may switch by angle. At/above: child freezes (skim-safe). */
    gesture_child_switch_max?: number;
    gesture_grand_enter?: number;
    gesture_grand_enter_hybrid?: number;
    /** On entry sector only — drop grand below this radius. */
    gesture_retrace_grand?: number;
    /** On entry sector only — drop child below this radius. */
    gesture_retrace_child?: number;
}

type GestureZone = 'dead' | 'parent' | 'switch' | 'freeze' | 'grand' | 'retrace';

type CaptureSample = {
    t: number;
    x: number;
    y: number;
    dist: number;
    angle: number;
    lock: number;
    child: number | null;
    grand: number | null;
    zone: GestureZone;
    childSwitchable: boolean;
    event?: string;
};

function resolveGestureThresholds(appearance?: AppearanceConfig | null) {
    return {
        childSwitchMax: appearance?.gesture_child_switch_max ?? 250,
        grandEnter: appearance?.gesture_grand_enter ?? 300,
        grandEnterHybrid: appearance?.gesture_grand_enter_hybrid ?? 320,
        retraceGrand: appearance?.gesture_retrace_grand ?? 180,
        retraceChild: appearance?.gesture_retrace_child ?? 140,
    };
}

function classifyZone(
    distance: number,
    childPickMin: number,
    th: ReturnType<typeof resolveGestureThresholds>,
    onEntryPath: boolean,
    lockLevel: number,
): GestureZone {
    if (distance < 40) return 'dead';
    if (
        onEntryPath
        && lockLevel >= 1
        && distance < th.retraceChild
    ) {
        return 'retrace';
    }
    if (
        onEntryPath
        && lockLevel >= 2
        && distance < th.retraceGrand
    ) {
        return 'retrace';
    }
    if (distance >= th.grandEnter) return 'grand';
    if (distance >= th.childSwitchMax) return 'freeze';
    if (distance >= childPickMin) return 'switch';
    return 'parent';
}

export interface MenuConfig {
    global_shortcut: string;
    appearance: AppearanceConfig;
    items: MenuItem[];
}

// Re-export type alias for internal use
type MenuItem = SliceItem;

/** True if a slot has a label, path, or nested filled slots (ignores empty editor padding). */
function isFilledSlot(item: MenuItem | undefined): boolean {
    if (!item) return false;
    if (item.name.trim() || item.path.trim()) return true;
    return (item.children ?? []).some(isFilledSlot);
}

function isGroupItem(item: MenuItem | undefined): boolean {
    if (!item) return false;
    const hasKids = (item.children ?? []).some(isFilledSlot);
    // Folder (no path) or hybrid/folder with real nested items
    return !item.path || hasKids;
}

function groupHasGrandRing(item: MenuItem | undefined): boolean {
    if (!item?.children) return false;
    return item.children.some(isGroupItem);
}

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
    const [activeGrandchildIndex, setActiveGrandchildIndex] = useState<number | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const isDraggingRef = React.useRef(false);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editingChildIndex, setEditingChildIndex] = useState<number | null>(null);
    const [editingGrandchildIndex, setEditingGrandchildIndex] = useState<number | null>(null);
    const [editingPos, setEditingPos] = useState<{ x: number; y: number } | null>(null);
    const isEditorOpenRef = React.useRef(false);
    const isPreferencesOpenRef = React.useRef(false);
    const hoveredIndexRef = React.useRef<number | null>(null);
    const lockLevelRef = React.useRef(0);
    const lockedMainRef = React.useRef<number | null>(null);
    const stickyChildRef = React.useRef<number | null>(null);
    const stickyGrandRef = React.useRef<number | null>(null);
    /** Once true, child won't clear/switch unless retreating on that child's sector (or dead zone). */
    const childLockedRef = React.useRef(false);
    const lastDistanceRef = React.useRef(0);
    const lastAngleRef = React.useRef(0);
    const lastShowTimeRef = React.useRef(0);
    const clickThroughStateRef = React.useRef({ editorOpen: false, hitDiskRadius: 180 });
    const trailRef = React.useRef<{ x: number; y: number }[]>([]);
    const captureRef = React.useRef<CaptureSample[]>([]);
    const gestureStartMsRef = React.useRef(0);
    const debugReviewTimerRef = React.useRef<number | null>(null);
    const [gestureTrail, setGestureTrail] = useState<{ x: number; y: number }[]>([]);
    const [captureTrail, setCaptureTrail] = useState<CaptureSample[]>([]);
    const [debugHud, setDebugHud] = useState<{
        lock: number;
        dist: number;
        angle: number;
        main: number | null;
        child: number | null;
        grand: number | null;
        zone: GestureZone;
        childSwitchable: boolean;
    } | null>(null);

    useEffect(() => {
        invoke<MenuConfig>('get_config')
            .then(config => {
                setItems(config.items);
                setConfigFull(config);
            })
            .catch(console.error);

        let unlistenDrag: UnlistenFn;
        let unlistenFile: UnlistenFn;

        const setupDropListeners = async () => {
            const handleDrop = (event: any) => {
                const paths = event.payload?.paths || event.payload;
                if (Array.isArray(paths) && paths.length > 0 && hoveredIndexRef.current !== null) {
                    setItems(prev => {
                        const newItems = [...prev];
                        const path = paths[0];
                        let name = path.split('\\').pop()?.split('/').pop() || 'App';
                        if (name.endsWith('.exe')) name = name.substring(0, name.length - 4);
                        newItems[hoveredIndexRef.current!] = { name, path, children: [] };
                        const newConfig = configFull ? { ...configFull, items: newItems } : { global_shortcut: 'alt+space', appearance: { panel_opacity: 0.8, panel_color: '#333333', text_size: 14, text_color: '#ffffff', animation_type: 'spread', hover_scale: 'small', hover_animation: 'none', hover_opacity: 1.0, sub_panel_opacity: 0.6, drag_opacity: 0.3, sub_panel_hover_opacity: 0.8, sub_panel_text_size: 12, sub_panel_text_color: '#ffffff' }, items: newItems };
                        invoke('update_config', { newConfig }).catch(console.error);
                        if (configFull) setConfigFull({ ...configFull, items: newItems });
                        return newItems;
                    });
                }
            };

            unlistenDrag = await listen('tauri://drag-drop', handleDrop);
            unlistenFile = await listen('tauri://file-drop', handleDrop);
        };
        setupDropListeners();

        const unlistenVisibility = (async () => {
            const l1 = await listen('menu-show', () => {
                if (debugReviewTimerRef.current !== null) {
                    window.clearTimeout(debugReviewTimerRef.current);
                    debugReviewTimerRef.current = null;
                }
                setIsVisible(true);
                lastShowTimeRef.current = Date.now();
            });
            const l2 = await listen('menu-hide', () => {
                if (isEditorOpenRef.current || isPreferencesOpenRef.current) return;
                setIsVisible(false);
                setIsDragging(false);
                lockLevelRef.current = 0;
                lockedMainRef.current = null;
                stickyChildRef.current = null;
                stickyGrandRef.current = null;
                childLockedRef.current = false;
                trailRef.current = [];
                setGestureTrail([]);
                setDebugHud(null);
                updateActiveIndex(null);
                setActiveChildIndex(null);
                setActiveGrandchildIndex(null);
                invoke('hide_menu').catch(console.error);
            });
            // Also reset on focus loss
            const l3 = await listen('tauri://blur', () => {
                // Focus guard: ignore blur events that happen immediately after show
                // to prevent flicker on first startup or OS focus quirks.
                if (Date.now() - lastShowTimeRef.current < 500) {
                    return;
                }
                if (isEditorOpenRef.current || isPreferencesOpenRef.current) return;
                setIsVisible(false);
                setIsDragging(false);
                lockLevelRef.current = 0;
                lockedMainRef.current = null;
                stickyChildRef.current = null;
                stickyGrandRef.current = null;
                childLockedRef.current = false;
                trailRef.current = [];
                setGestureTrail([]);
                setDebugHud(null);
                updateActiveIndex(null);
                setActiveChildIndex(null);
                setActiveGrandchildIndex(null);
            });
            const l4 = await listen('reload-config', () => {
                invoke<MenuConfig>('get_config')
                    .then(config => {
                        setItems(config.items);
                        setConfigFull(config);
                    })
                    .catch(console.error);
            });
            const l5 = await listen('editor-closed', () => {
                isEditorOpenRef.current = false;
                setEditingIndex(null);
                setEditingChildIndex(null);
                setEditingGrandchildIndex(null);
            });
            const l6 = await listen('preferences-opened', () => {
                isPreferencesOpenRef.current = true;
            });
            const l7 = await listen('preferences-closed', () => {
                isPreferencesOpenRef.current = false;
            });
            return [l1, l2, l3, l4, l5, l6, l7];
        })();

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

    useEffect(() => {
        if (!isVisible) {
            invoke('reset_main_click_through').catch(() => {});
            return;
        }
        const tick = () => {
            const s = clickThroughStateRef.current;
            const extraHitRects: { x: number; y: number; width: number; height: number }[] = [];
            if (s.editorOpen) {
                document
                    .querySelectorAll<HTMLElement>('.slice-editor, .slice-editor-picker-menu')
                    .forEach(el => {
                        const r = el.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) {
                            extraHitRects.push({
                                x: r.left,
                                y: r.top,
                                width: r.width,
                                height: r.height,
                            });
                        }
                    });
            }
            invoke('sync_main_click_through', {
                hitDiskRadiusLogical: s.hitDiskRadius,
                extraHitRects: extraHitRects.length > 0 ? extraHitRects : null,
            }).catch(() => {});
        };
        tick();
        const id = window.setInterval(tick, 32);
        return () => {
            clearInterval(id);
            invoke('reset_main_click_through').catch(() => {});
        };
    }, [isVisible]);

    const updateActiveChildIndex = (index: number | null) => {
        if (activeChildIndex !== index) {
            setActiveGrandchildIndex(null);
        }
        setActiveChildIndex(index);
    };

    // Update the activeIndex and hover proxy together
    const updateActiveIndex = (index: number | null) => {
        if (activeIndex !== index) {
            setActiveChildIndex(null);
            setActiveGrandchildIndex(null);
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
    const childInnerRadius = 180; // connect seamlessly with outerRadius
    const childOuterRadius = 300;

    // Grandchild ring dimensions
    const grandInnerRadius = 300;
    const grandOuterRadius = 420;

    // We will display 8 children slots per parent in a full circle
    const maxChildrenVisible = 8;
    const childFanAngle = 360; // Total angle span is a full circle
    const childSliceAngle = childFanAngle / maxChildrenVisible;
    const childHalfSlice = childSliceAngle / 2;

    const gestureDebug = !!configFull?.appearance?.gesture_path_debug;
    const gestureCapture = !!configFull?.appearance?.gesture_path_capture;
    const showGestureOverlay = gestureDebug || gestureCapture;
    const th = resolveGestureThresholds(configFull?.appearance);
    const DEAD_ZONE = 40;

    const pushTrailPoint = (x: number, y: number) => {
        if (!showGestureOverlay) return;
        const trail = trailRef.current;
        const last = trail[trail.length - 1];
        if (last) {
            const dx = x - last.x;
            const dy = y - last.y;
            if (dx * dx + dy * dy < 9) return;
        }
        trail.push({ x, y });
        if (trail.length > 400) trail.shift();
        setGestureTrail([...trail]);
    };

    const pushCaptureSample = (sample: CaptureSample) => {
        if (!gestureCapture) return;
        const samples = captureRef.current;
        const last = samples[samples.length - 1];
        if (last) {
            const dx = sample.x - last.x;
            const dy = sample.y - last.y;
            if (dx * dx + dy * dy < 16 && !sample.event) return;
        }
        samples.push(sample);
        if (samples.length > 600) samples.shift();
        setCaptureTrail([...samples]);
    };

    const finalizeCapture = () => {
        if (!gestureCapture || captureRef.current.length === 0) return;
        const payload = {
            at: new Date().toISOString(),
            thresholds: th,
            samples: captureRef.current,
        };
        try {
            localStorage.setItem('hue_last_gesture_capture', JSON.stringify(payload));
        } catch {
            /* ignore quota */
        }
        console.log('[Hue gesture capture]', payload);
    };

    const syncSelectionFromSticky = () => {
        updateActiveChildIndex(stickyChildRef.current);
        setActiveGrandchildIndex(stickyGrandRef.current);
    };

    const dismissMenu = () => {
        trailRef.current = [];
        setGestureTrail([]);
        captureRef.current = [];
        setCaptureTrail([]);
        setDebugHud(null);
        setIsVisible(false);
        updateActiveIndex(null);
        updateActiveChildIndex(null);
        setActiveGrandchildIndex(null);
        invoke('hide_menu').catch(console.error);
    };

    const endDragGesture = (e?: { currentTarget?: EventTarget | null; pointerId?: number }) => {
        if (!isDraggingRef.current) return;
        if (isEditorOpenRef.current) return;
        isDraggingRef.current = false;
        setIsDragging(false);

        if (e?.currentTarget && e.pointerId !== undefined) {
            try {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            } catch {
                /* ignore */
            }
        }

        const launchChild = stickyChildRef.current;
        const launchGrand = stickyGrandRef.current;
        const launchMain = lockedMainRef.current ?? hoveredIndexRef.current;

        finalizeCapture();

        lockLevelRef.current = 0;
        lockedMainRef.current = null;
        stickyChildRef.current = null;
        stickyGrandRef.current = null;
        childLockedRef.current = false;

        if (launchMain !== null) {
            const currentItem = configRef.current[launchMain];
            const launchIfAssigned = (path: string | undefined) => {
                const p = path?.trim();
                if (p) invoke('launch_app', { path: p }).catch(console.error);
            };

            if (lastDistanceRef.current < DEAD_ZONE) {
                // Canceled in center — still dismiss below
            } else if (
                launchChild !== null &&
                launchGrand !== null &&
                currentItem.children &&
                currentItem.children.length > launchChild
            ) {
                const grandItem = currentItem.children[launchChild].children?.[launchGrand];
                launchIfAssigned(grandItem?.path);
            } else if (launchChild !== null && currentItem.children && currentItem.children.length > launchChild) {
                launchIfAssigned(currentItem.children[launchChild]?.path);
            } else {
                launchIfAssigned(currentItem.path);
            }
        }

        if (debugReviewTimerRef.current !== null) {
            window.clearTimeout(debugReviewTimerRef.current);
            debugReviewTimerRef.current = null;
        }
        dismissMenu();
    };

    const handlePointerDown = (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        if (isEditorOpenRef.current) return;
        if (debugReviewTimerRef.current !== null) {
            window.clearTimeout(debugReviewTimerRef.current);
            debugReviewTimerRef.current = null;
        }
        isDraggingRef.current = true;
        setIsDragging(true);
        lockLevelRef.current = 0;
        lockedMainRef.current = null;
        stickyChildRef.current = null;
        stickyGrandRef.current = null;
        childLockedRef.current = false;
        trailRef.current = [];
        setGestureTrail([]);
        captureRef.current = [];
        setCaptureTrail([]);
        gestureStartMsRef.current = performance.now();
        // Capture so release outside the hit-disk still ends the gesture and hides the menu
        try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
            /* ignore */
        }
        handlePointerMove(e);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDraggingRef.current) {
            return;
        }

        const rect = e.currentTarget.getBoundingClientRect();
        // Map into the 1000×1000 container space (same as HTML labels — not the rotated pie-svg)
        const scaleX = size / rect.width;
        const scaleY = size / rect.height;
        const dx = (e.clientX - rect.left) * scaleX - center;
        const dy = (e.clientY - rect.top) * scaleY - center;
        const distance = Math.sqrt(dx * dx + dy * dy);
        lastDistanceRef.current = distance;

        let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        angleDeg = (angleDeg + 90 + 360) % 360;
        lastAngleRef.current = angleDeg;

        const px = center + dx;
        const py = center + dy;
        pushTrailPoint(px, py);

        const adjusted = (angleDeg + halfSlice) % 360;
        const potentialMainIndex = Math.floor(adjusted / sliceAngle);
        const childAdjusted = (angleDeg + childHalfSlice) % 360;
        const potentialChildIndex = Math.floor(childAdjusted / childSliceAngle);
        const potentialGrandIndex = potentialChildIndex;

        let captureEvent: string | undefined;
        const prevChild = stickyChildRef.current;
        const prevGrand = stickyGrandRef.current;
        const prevLock = lockLevelRef.current;

        // ── Level 0: free main selection; lock into a group when entering its ring ──
        if (lockLevelRef.current === 0) {
            if (distance < DEAD_ZONE) {
                updateActiveIndex(null);
                lockedMainRef.current = null;
            } else if (potentialMainIndex >= 0 && potentialMainIndex < items.length) {
                updateActiveIndex(potentialMainIndex);
                const main = items[potentialMainIndex];
                if (isGroupItem(main) && distance >= innerRadius) {
                    lockedMainRef.current = potentialMainIndex;
                    lockLevelRef.current = 1;
                    captureEvent = 'enter_child_ring';
                }
            }
        }

        const lockedMain = lockedMainRef.current;
        const mainHasPath = lockedMain !== null ? !!items[lockedMain]?.path : false;
        const childPickMin = mainHasPath ? 140 : 70;

        // ── Level 1: switch zone vs freeze zone; retrace only on entry sector ──
        if (lockLevelRef.current === 1 && lockedMain !== null) {
            const onChildPath =
                stickyChildRef.current !== null && potentialChildIndex === stickyChildRef.current;

            if (distance < DEAD_ZONE) {
                stickyChildRef.current = null;
                stickyGrandRef.current = null;
                childLockedRef.current = false;
                lockLevelRef.current = 0;
                lockedMainRef.current = null;
                updateActiveIndex(null);
                captureEvent = captureEvent ?? 'dead_unlock';
                syncSelectionFromSticky();
            } else if (
                childLockedRef.current
                && stickyChildRef.current !== null
                && onChildPath
                && distance < th.retraceChild
            ) {
                // Retrace entry corridor → drop child (not via other sectors / center alone)
                stickyChildRef.current = null;
                stickyGrandRef.current = null;
                childLockedRef.current = false;
                captureEvent = captureEvent ?? 'retrace_child';
                syncSelectionFromSticky();
            } else if (
                distance >= childPickMin
                && distance < th.childSwitchMax
                && potentialChildIndex >= 0
                && potentialChildIndex < maxChildrenVisible
            ) {
                // SWITCH ZONE — child may change (pick target before committing outward)
                if (stickyChildRef.current !== potentialChildIndex) {
                    captureEvent = captureEvent ?? 'child_switch';
                }
                stickyChildRef.current = potentialChildIndex;
                stickyGrandRef.current = null;
                childLockedRef.current = false;
                syncSelectionFromSticky();
            } else if (distance >= th.childSwitchMax) {
                // FREEZE ZONE — child sticks; skimming other child angles does not switch
                if (
                    stickyChildRef.current === null
                    && potentialChildIndex >= 0
                    && potentialChildIndex < maxChildrenVisible
                ) {
                    stickyChildRef.current = potentialChildIndex;
                    captureEvent = captureEvent ?? 'child_commit';
                }
                if (stickyChildRef.current !== null) {
                    childLockedRef.current = true;
                    stickyGrandRef.current = null;
                    const childItem = items[lockedMain]?.children?.[stickyChildRef.current];
                    if (isGroupItem(childItem)) {
                        const grandEnter = childItem?.path ? th.grandEnterHybrid : th.grandEnter;
                        if (distance >= grandEnter) {
                            lockLevelRef.current = 2;
                            captureEvent = captureEvent ?? 'grand_enter';
                        }
                    }
                }
                syncSelectionFromSticky();
            } else if (childLockedRef.current || stickyChildRef.current !== null) {
                // Parent band off-path: keep selection, do not close via wrong sector
                syncSelectionFromSticky();
            }
        }

        // ── Level 2: grand by angle; child frozen; retreat only on entry corridor ──
        if (lockLevelRef.current === 2 && lockedMain !== null) {
            childLockedRef.current = true;
            const stickyChild = stickyChildRef.current;
            const onChildPath =
                stickyChild !== null && potentialChildIndex === stickyChild;
            const childItem = stickyChild !== null
                ? items[lockedMain]?.children?.[stickyChild]
                : undefined;
            const grandEnter = childItem?.path ? th.grandEnterHybrid : th.grandEnter;

            if (distance < DEAD_ZONE) {
                stickyChildRef.current = null;
                stickyGrandRef.current = null;
                childLockedRef.current = false;
                lockLevelRef.current = 0;
                lockedMainRef.current = null;
                updateActiveIndex(null);
                captureEvent = captureEvent ?? 'dead_unlock';
            } else if (onChildPath && distance < th.retraceGrand) {
                stickyGrandRef.current = null;
                lockLevelRef.current = 1;
                captureEvent = captureEvent ?? 'retrace_grand';
                if (distance < th.retraceChild) {
                    stickyChildRef.current = null;
                    childLockedRef.current = false;
                    captureEvent = 'retrace_child';
                }
            } else if (
                stickyChild !== null
                && distance >= grandEnter
                && potentialGrandIndex >= 0
                && potentialGrandIndex < maxChildrenVisible
            ) {
                if (stickyGrandRef.current !== potentialGrandIndex) {
                    captureEvent = captureEvent ?? 'grand_switch';
                }
                stickyGrandRef.current = potentialGrandIndex;
            }
            // Off-path / mid freeze: keep child+grand — brush other children without switching
            syncSelectionFromSticky();
        }

        // Expand OS hit-test early so the cursor can reach the grand ring
        if (lockedMainRef.current !== null && groupHasGrandRing(items[lockedMainRef.current])) {
            clickThroughStateRef.current.hitDiskRadius = grandOuterRadius;
        } else if (lockLevelRef.current >= 1) {
            clickThroughStateRef.current.hitDiskRadius = childOuterRadius;
        }

        const onEntryPath =
            stickyChildRef.current !== null && potentialChildIndex === stickyChildRef.current;
        const zone = classifyZone(
            distance,
            childPickMin,
            th,
            onEntryPath,
            lockLevelRef.current,
        );
        const childSwitchable =
            lockLevelRef.current === 1
            && distance >= childPickMin
            && distance < th.childSwitchMax;

        if (showGestureOverlay) {
            setDebugHud({
                lock: lockLevelRef.current,
                dist: Math.round(distance),
                angle: Math.round(angleDeg),
                main: lockedMainRef.current ?? hoveredIndexRef.current,
                child: stickyChildRef.current,
                grand: stickyGrandRef.current,
                zone,
                childSwitchable,
            });
        }

        if (gestureCapture) {
            const switched =
                prevChild !== stickyChildRef.current
                || prevGrand !== stickyGrandRef.current
                || prevLock !== lockLevelRef.current;
            pushCaptureSample({
                t: Math.round(performance.now() - gestureStartMsRef.current),
                x: px,
                y: py,
                dist: Math.round(distance),
                angle: Math.round(angleDeg),
                lock: lockLevelRef.current,
                child: stickyChildRef.current,
                grand: stickyGrandRef.current,
                zone,
                childSwitchable,
                event: captureEvent ?? (switched ? 'state_change' : undefined),
            });
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        endDragGesture(e);
    };

    const handlePointerCancel = (e: React.PointerEvent) => {
        endDragGesture(e);
    };

    // Backup: if capture fails, window still ends the drag when releasing outside the pie
    useEffect(() => {
        if (!isDragging) return;
        const onWinUp = (ev: PointerEvent) => {
            if (ev.button !== 0) return;
            endDragGesture();
        };
        const onWinCancel = () => endDragGesture();
        window.addEventListener('pointerup', onWinUp);
        window.addEventListener('pointercancel', onWinCancel);
        return () => {
            window.removeEventListener('pointerup', onWinUp);
            window.removeEventListener('pointercancel', onWinCancel);
        };
    }, [isDragging]);

    // Use onContextMenu to prevent the right-click menu, allowing drag with both left/right click.
    const handleContextMenu = (_e: React.MouseEvent) => _e.preventDefault();

    const handleOpenEditor = (index: number, childIdx: number | null = null, grandchildIdx: number | null = null) => {
        setEditingIndex(index);
        setEditingChildIndex(childIdx);
        setEditingGrandchildIndex(grandchildIdx);

        if (grandchildIdx !== null && childIdx !== null) {
            const midAngle = grandchildIdx * childSliceAngle;
            const angleInRadians = ((midAngle - 90) * Math.PI) / 180.0;
            const outRadius = grandOuterRadius + 80;
            let spawnX = center + outRadius * Math.cos(angleInRadians);
            let spawnY = center + outRadius * Math.sin(angleInRadians);
            spawnX = Math.max(200, Math.min(800, spawnX));
            spawnY = Math.max(280, Math.min(720, spawnY));
            setEditingPos({ x: spawnX, y: spawnY });
            isEditorOpenRef.current = true;
            return;
        }

        if (childIdx !== null) {
            const midAngle = childIdx * childSliceAngle;
            const angleInRadians = ((midAngle - 90) * Math.PI) / 180.0;
            const outRadius = childOuterRadius + 80;
            let spawnX = center + outRadius * Math.cos(angleInRadians);
            let spawnY = center + outRadius * Math.sin(angleInRadians);
            spawnX = Math.max(200, Math.min(800, spawnX));
            spawnY = Math.max(280, Math.min(720, spawnY));
            setEditingPos({ x: spawnX, y: spawnY });
            isEditorOpenRef.current = true;
            return;
        }

        const midAngle = index * sliceAngle;
        const textRadius = innerRadius + (outerRadius - innerRadius) / 2;
        const angleInRadians = ((midAngle - 90) * Math.PI) / 180.0;
        const x = center + textRadius * Math.cos(angleInRadians);
        const y = center + textRadius * Math.sin(angleInRadians);

        const cx = x - center;
        const cy = y - center;
        const length = Math.sqrt(cx * cx + cy * cy);

        const outRadius = outerRadius + 80;
        let spawnX = center + (cx / length) * outRadius;
        let spawnY = center + (cy / length) * outRadius;

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
            '--hover-opacity': appearance.hover_opacity ?? 1.0,
            '--sub-panel-opacity': appearance.sub_panel_opacity ?? 0.6,
            '--drag-opacity': appearance.drag_opacity ?? 0.3,
            '--sub-panel-hover-opacity': appearance.sub_panel_hover_opacity ?? 0.8,
            '--sub-text-size': `${appearance.sub_panel_text_size ?? 12}px`,
            '--sub-text-color': appearance.sub_panel_text_color ?? appearance.text_color ?? '#ffffff',
        } as React.CSSProperties;
    }, [configFull]);

    const animClass = configFull?.appearance?.animation_type ? `anim-${configFull.appearance.animation_type}` : 'anim-spread';
    const hoverAnimClass = configFull?.appearance?.hover_animation ? `hover-anim-${configFull.appearance.hover_animation}` : 'hover-anim-none';

    const isGroupOpen =
        activeIndex !== null &&
        !!items[activeIndex] &&
        isGroupItem(items[activeIndex]);

    const activeChildItem =
        activeIndex !== null && activeChildIndex !== null
            ? items[activeIndex]?.children?.[activeChildIndex]
            : undefined;

    const isGrandGroupOpen =
        isGroupOpen &&
        activeChildIndex !== null &&
        isGroupItem(activeChildItem);

    // If any sub can open a grand ring, keep the hit disk large from the moment the parent opens
    // so the pointer is not clipped by OS click-through before React expands the ring.
    const hitDiskRadius =
        isGroupOpen && groupHasGrandRing(items[activeIndex!])
            ? grandOuterRadius
            : isGrandGroupOpen
                ? grandOuterRadius
                : isGroupOpen
                    ? childOuterRadius
                    : outerRadius;

    clickThroughStateRef.current = {
        editorOpen: editingIndex !== null,
        hitDiskRadius,
    };

    return (
        <div
            className={`pie-menu-container ${isVisible ? 'visible' : ''} ${animClass}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onContextMenu={handleContextMenu}
            style={customStyles}
        >
            <svg className="pie-svg" viewBox={`0 0 ${size} ${size}`}>
                <defs>
                    <filter id="glass-blur">
                        <feGaussianBlur stdDeviation="5" />
                    </filter>
                </defs>
                {/* Invisible disk: limits hit-testing to the pie rings (container uses pointer-events: none). Center uses .center-hole above in DOM. */}
                <circle
                    className="pie-hit-disk"
                    cx={center}
                    cy={center}
                    r={hitDiskRadius}
                    fill="rgba(0,0,0,0.01)"
                />
                {items.map((_item, index) => {
                    const startAngle = index * sliceAngle - halfSlice;
                    // small gap between slices for aesthetics
                    const endAngle = startAngle + sliceAngle - 2;

                    const pathD = describeArc(center, center, innerRadius, outerRadius, startAngle, endAngle);

                    let isActive = false;
                    if (isGrandGroupOpen) {
                        isActive = activeGrandchildIndex === index;
                    } else if (isGroupOpen) {
                        isActive = activeChildIndex === index;
                    } else {
                        isActive = activeIndex === index;
                    }

                    return (
                        <path
                            key={index}
                            d={pathD}
                            className={`slice-path ${isActive ? 'active' : ''} ${hoverAnimClass}`}
                            style={{
                                opacity:
                                    (isGroupOpen && activeIndex !== index && activeChildIndex !== index && !isGrandGroupOpen) ||
                                    (isGrandGroupOpen && activeChildIndex !== index && activeGrandchildIndex !== index)
                                        ? 0.3
                                        : undefined,
                            }}
                            onContextMenu={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (isGrandGroupOpen) {
                                    handleOpenEditor(activeIndex!, activeChildIndex!, index);
                                } else if (isGroupOpen) {
                                    handleOpenEditor(activeIndex!, index);
                                } else {
                                    handleOpenEditor(index);
                                }
                            }}
                        />
                    );
                })}
                {/* ── Sub-menu ring (Dynamic) ── */}
                {activeIndex !== null && (() => {
                    const currentItem = items[activeIndex];
                    if (!currentItem) return null;
                    if (!isGroupItem(currentItem)) return null;

                    return Array.from({ length: maxChildrenVisible }).map((_, idx) => {
                        const startAngle = idx * childSliceAngle - childHalfSlice;
                        const endAngle = startAngle + childSliceAngle - 2;
                        const pathD = describeArc(center, center, childInnerRadius, childOuterRadius, startAngle, endAngle);
                        const isChildActive = activeChildIndex === idx;

                        return (
                            <path
                                key={`child-${activeIndex}-${idx}`}
                                d={pathD}
                                className={`slice-path outer-slice ${isChildActive ? 'active' : ''} ${hoverAnimClass}`}
                                style={{
                                    opacity: isGrandGroupOpen && activeChildIndex !== idx ? 0.3 : undefined,
                                }}
                                onContextMenu={e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleOpenEditor(activeIndex, idx);
                                }}
                            />
                        );
                    });
                })()}
                {/* ── Grandchild ring ── */}
                {isGrandGroupOpen && activeIndex !== null && activeChildIndex !== null && (() => {
                    const childItem = items[activeIndex]?.children?.[activeChildIndex];
                    if (!childItem || !isGroupItem(childItem)) return null;

                    return Array.from({ length: maxChildrenVisible }).map((_, idx) => {
                        const startAngle = idx * childSliceAngle - childHalfSlice;
                        const endAngle = startAngle + childSliceAngle - 2;
                        const pathD = describeArc(center, center, grandInnerRadius, grandOuterRadius, startAngle, endAngle);
                        const isGrandActive = activeGrandchildIndex === idx;

                        return (
                            <path
                                key={`grand-${activeIndex}-${activeChildIndex}-${idx}`}
                                d={pathD}
                                className={`slice-path outer-slice ${isGrandActive ? 'active' : ''} ${hoverAnimClass}`}
                                onContextMenu={e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleOpenEditor(activeIndex, activeChildIndex, idx);
                                }}
                            />
                        );
                    });
                })()}
            </svg>

            {/* Unrotated overlay: pie-svg uses rotate(-90deg), so trail/rings must live outside it */}
            {showGestureOverlay && (
                <svg
                    className="gesture-debug-overlay"
                    viewBox={`0 0 ${size} ${size}`}
                    pointerEvents="none"
                >
                    <g className="gesture-debug-rings">
                        <circle cx={center} cy={center} r={DEAD_ZONE} className="gesture-debug-ring dead" />
                        <circle cx={center} cy={center} r={innerRadius} className="gesture-debug-ring main-in" />
                        <circle cx={center} cy={center} r={outerRadius} className="gesture-debug-ring main-out" />
                        <circle cx={center} cy={center} r={childOuterRadius} className="gesture-debug-ring child-out" />
                        <circle cx={center} cy={center} r={grandOuterRadius} className="gesture-debug-ring grand-out" />
                        <circle cx={center} cy={center} r={th.retraceChild} className="gesture-debug-ring retrace-child" />
                        <circle cx={center} cy={center} r={th.retraceGrand} className="gesture-debug-ring retrace-grand" />
                        <circle cx={center} cy={center} r={th.childSwitchMax} className="gesture-debug-ring child-commit" />
                        <circle cx={center} cy={center} r={th.grandEnter} className="gesture-debug-ring grand-pick" />
                        <circle cx={center} cy={center} r={th.grandEnterHybrid} className="gesture-debug-ring grand-pick-hybrid" />
                    </g>
                    {gestureCapture && captureTrail.length > 1
                        ? captureTrail.slice(1).map((sample, i) => {
                            const prev = captureTrail[i];
                            const zoneColor =
                                sample.zone === 'switch' ? '#4ade80'
                                    : sample.zone === 'freeze' ? '#fbbf24'
                                        : sample.zone === 'grand' ? '#38bdf8'
                                            : sample.zone === 'retrace' ? '#f472b6'
                                                : sample.zone === 'dead' ? '#94a3b8'
                                                    : '#a78bfa';
                            return (
                                <line
                                    key={`cap-${i}-${sample.t}`}
                                    className="gesture-capture-segment"
                                    x1={prev.x}
                                    y1={prev.y}
                                    x2={sample.x}
                                    y2={sample.y}
                                    stroke={zoneColor}
                                />
                            );
                        })
                        : gestureTrail.length > 1 && (
                            <polyline
                                className="gesture-debug-trail"
                                fill="none"
                                points={gestureTrail.map(p => `${p.x},${p.y}`).join(' ')}
                            />
                        )}
                    {(gestureCapture ? captureTrail : gestureTrail).length > 0 && (() => {
                        const pts = gestureCapture ? captureTrail : gestureTrail;
                        const last = pts[pts.length - 1];
                        return (
                            <circle
                                className="gesture-debug-cursor"
                                cx={last.x}
                                cy={last.y}
                                r={6}
                            />
                        );
                    })()}
                </svg>
            )}

            {/* Sub-menu labels */}
            {activeIndex !== null && (() => {
                const currentItem = items[activeIndex];
                if (!currentItem) return null;
                if (!isGroupItem(currentItem)) return null;

                return Array.from({ length: maxChildrenVisible }).map((_, idx) => {
                    const child = currentItem.children?.[idx];
                    const midAngle = idx * childSliceAngle;

                    const textRadius = childInnerRadius + (childOuterRadius - childInnerRadius) / 2;
                    const angleInRadians = ((midAngle - 90) * Math.PI) / 180.0;
                    const x = center + textRadius * Math.cos(angleInRadians);
                    const y = center + textRadius * Math.sin(angleInRadians);

                    const childName = child?.name ? child.name : "＋";
                    const isPlaceholder = !child?.name;
                    const childIsGroup = isGroupItem(child);

                    return (
                        <div
                            key={`child-label-${activeIndex}-${idx}`}
                            className="slice-content outer-label"
                            style={{
                                left: `${x}px`,
                                top: `${y}px`,
                                opacity: isGrandGroupOpen && activeChildIndex !== idx
                                    ? 0.3
                                    : isPlaceholder
                                        ? 0.3
                                        : 1,
                            }}
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
                            {childIsGroup && (
                                <div style={{ fontSize: '12px', lineHeight: 1, marginTop: '2px', color: 'rgba(255,255,255,0.4)', opacity: activeChildIndex === idx ? 1 : 0.5 }}>
                                    •••
                                </div>
                            )}
                        </div>
                    );
                });
            })()}

            {/* Grandchild labels */}
            {isGrandGroupOpen && activeIndex !== null && activeChildIndex !== null && (() => {
                const childItem = items[activeIndex]?.children?.[activeChildIndex];
                if (!childItem) return null;

                return Array.from({ length: maxChildrenVisible }).map((_, idx) => {
                    const grand = childItem.children?.[idx];
                    const midAngle = idx * childSliceAngle;

                    const textRadius = grandInnerRadius + (grandOuterRadius - grandInnerRadius) / 2;
                    const angleInRadians = ((midAngle - 90) * Math.PI) / 180.0;
                    const x = center + textRadius * Math.cos(angleInRadians);
                    const y = center + textRadius * Math.sin(angleInRadians);

                    const grandName = grand?.name ? grand.name : "＋";
                    const isPlaceholder = !grand?.name;

                    return (
                        <div
                            key={`grand-label-${activeIndex}-${activeChildIndex}-${idx}`}
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
                                handleOpenEditor(activeIndex, activeChildIndex, idx);
                            }}
                        >
                            {grandName}
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
                        style={{ left: `${x}px`, top: `${y}px`, opacity: activeIndex !== null && activeIndex !== index ? 0.3 : 1 }}
                        onPointerDown={e => {
                            if (e.button === 2) e.stopPropagation();
                        }}
                        onPointerUp={e => {
                            if (e.button === 2) e.stopPropagation();
                        }}
                        onContextMenu={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (isGrandGroupOpen) {
                                handleOpenEditor(activeIndex!, activeChildIndex!, index);
                            } else if (isGroupOpen) {
                                handleOpenEditor(activeIndex!, index);
                            } else {
                                handleOpenEditor(index);
                            }
                        }}
                    >
                        {item.name}
                        {isGroupItem(item) && (
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
                    isPreferencesOpenRef.current = true;
                    invoke('open_preferences_window').catch(console.error);
                }}
                title="Right-click for Preferences"
            >
                <div className="center-text">HUE</div>
            </div>

            {showGestureOverlay && debugHud && (
                <div className="gesture-debug-hud" style={{ pointerEvents: 'none' }}>
                    <div>lock {debugHud.lock} · dist {debugHud.dist} · ang {debugHud.angle}° · zone {debugHud.zone}</div>
                    <div>main {debugHud.main ?? '—'} · child {debugHud.child ?? '—'} · grand {debugHud.grand ?? '—'}</div>
                    <div className="gesture-debug-hud-hint">
                        child {debugHud.childSwitchable ? 'SWITCHABLE' : 'FROZEN'}
                        {' · '}switch&lt;{th.childSwitchMax} · freeze≥{th.childSwitchMax} · grand≥{th.grandEnter}
                        {gestureCapture ? ' · capture→console/localStorage' : ''}
                    </div>
                </div>
            )}

            {editingIndex !== null && editingPos && items[editingIndex] && (() => {
                const editingItem =
                    editingGrandchildIndex !== null && editingChildIndex !== null
                        ? (items[editingIndex].children?.[editingChildIndex]?.children?.[editingGrandchildIndex]
                            || { name: '', path: '', children: [] })
                        : editingChildIndex !== null
                            ? (items[editingIndex].children?.[editingChildIndex]
                                || { name: '', path: '', children: [] })
                            : items[editingIndex];

                const editorKey = editingGrandchildIndex !== null
                    ? `editor-${editingIndex}-${editingChildIndex}-${editingGrandchildIndex}`
                    : editingChildIndex !== null
                        ? `editor-${editingIndex}-${editingChildIndex}`
                        : `editor-${editingIndex}-main`;

                return (
                <SliceEditor
                    key={editorKey}
                    item={editingItem}
                    position={editingPos}
                    allowChildren={editingGrandchildIndex === null}
                    addChildrenLabel={editingChildIndex !== null ? '+ Add nested items' : '+ Add sub-items'}
                    groupChildrenLabel={editingChildIndex !== null ? 'Nested Items (8 Slots)' : 'Group Items (8 Slots)'}
                    onSave={(updatedItem: SliceItem) => {
                        const newItems = [...items];

                        if (editingGrandchildIndex !== null && editingChildIndex !== null) {
                            const parent = { ...newItems[editingIndex] };
                            const newChildren = [...(parent.children || [])];
                            while (newChildren.length <= editingChildIndex) {
                                newChildren.push({ name: '', path: '', children: [] });
                            }
                            const child = { ...newChildren[editingChildIndex] };
                            const newGrandchildren = [...(child.children || [])];
                            while (newGrandchildren.length <= editingGrandchildIndex) {
                                newGrandchildren.push({ name: '', path: '', children: [] });
                            }
                            newGrandchildren[editingGrandchildIndex] = updatedItem;
                            child.children = newGrandchildren;
                            newChildren[editingChildIndex] = child;
                            parent.children = newChildren;
                            newItems[editingIndex] = parent;
                        } else if (editingChildIndex !== null) {
                            const parent = { ...newItems[editingIndex] };
                            const newChildren = [...(parent.children || [])];
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
                        const newConfig = configFull ? { ...configFull, items: newItems } : { global_shortcut: 'alt+space', appearance: { panel_opacity: 0.8, panel_color: '#333333', text_size: 14, text_color: '#ffffff', animation_type: 'spread', hover_scale: 'small', hover_animation: 'none', hover_opacity: 1.0, sub_panel_opacity: 0.6, drag_opacity: 0.3, sub_panel_hover_opacity: 0.8, sub_panel_text_size: 12, sub_panel_text_color: '#ffffff' }, items: newItems };
                        invoke('update_config', { newConfig }).catch(console.error);
                        if (configFull) setConfigFull(newConfig);
                        setEditingIndex(null);
                        setEditingChildIndex(null);
                        setEditingGrandchildIndex(null);
                        isEditorOpenRef.current = false;
                    }}
                    onCancel={() => {
                        setEditingIndex(null);
                        setEditingChildIndex(null);
                        setEditingGrandchildIndex(null);
                        isEditorOpenRef.current = false;
                    }}
                />
                );
            })()}
        </div>
    );
};
