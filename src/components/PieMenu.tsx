import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { SliceEditor, SliceItem } from './SliceEditor';
import type { AppearancePreviewPayload } from '../lib/appearanceDefaults';
import {
    markingTrailSegments,
    pushMarkingTrailPoint,
    type MarkingTrailPoint,
} from '../lib/markingTrail';
import { resolveGestureThresholds, resolveRingGeometry } from '../lib/ringGeometry';

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
    ring_span_scale?: number;
    parent_ring_weight?: number;
    child_ring_weight?: number;
    grand_ring_weight?: number;
    gesture_child_split_ratio?: number;
    gesture_path_pick_ratio?: number;
    gesture_retrace_child_ratio?: number;
    gesture_grand_hybrid_extra_ratio?: number;
    /** @deprecated legacy px — migrated to ratios */
    gesture_child_switch_max?: number;
    gesture_grand_enter?: number;
    gesture_grand_enter_hybrid?: number;
    gesture_retrace_grand?: number;
    gesture_retrace_child?: number;
    /** @deprecated legacy px thickness */
    parent_ring_thickness?: number;
    child_ring_thickness?: number;
    grand_ring_thickness?: number;
    prefs_bg?: string;
    prefs_accent?: string;
    prefs_text?: string;
    prefs_chrome?: 'normal' | 'glass' | string;
    center_label?: string;
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

/** Child ring geometry — path split uses the radial midpoint by default. */
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
        && distance < th.childSwitchMax
    ) {
        return 'retrace';
    }
    // Outer child half + beyond with grand lock = path aiming at grand
    if (lockLevel >= 2 && distance >= th.childSwitchMax) return 'grand';
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

function isAutoGroup(item: MenuItem | undefined): boolean {
    return !!item?.auto?.enabled;
}

/** Path to reveal in Explorer: assigned path, else Auto source folder. */
function resolveRevealPath(item: MenuItem | undefined): string | null {
    if (!item) return null;
    const path = item.path?.trim();
    if (path) return path;
    const folder = item.auto?.folder?.trim();
    if (folder) return folder;
    return null;
}

function positiveMod(n: number, m: number): number {
    if (m <= 0) return 0;
    return ((n % m) + m) % m;
}

function updateUnwrappedAngle(
    unwrappedRef: React.MutableRefObject<number>,
    lastRawRef: React.MutableRefObject<number | null>,
    angleDeg: number,
) {
    if (lastRawRef.current === null) {
        lastRawRef.current = angleDeg;
        unwrappedRef.current = angleDeg;
        return;
    }
    let delta = angleDeg - lastRawRef.current;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    unwrappedRef.current += delta;
    lastRawRef.current = angleDeg;
}

function spiralBaseFromUnwrapped(unwrapped: number, sliceAngle: number, n: number): number {
    return positiveMod(Math.floor(unwrapped / sliceAngle), n);
}

function spiralIndexFromUnwrapped(unwrapped: number, sliceAngle: number, n: number): number {
    return positiveMod(Math.floor(unwrapped / sliceAngle), n);
}

const maxChildrenVisibleConst = 8;

function ringIndexFromAngle(
    angleDeg: number,
    n: number,
    sliceAngle: number,
    halfSlice: number,
    spiral: boolean,
    unwrappedRef: React.MutableRefObject<number>,
    lastRawRef: React.MutableRefObject<number | null>,
): number {
    if (!spiral || n <= maxChildrenVisibleConst) {
        const adjusted = (angleDeg + halfSlice) % 360;
        return Math.floor(adjusted / sliceAngle);
    }
    updateUnwrappedAngle(unwrappedRef, lastRawRef, angleDeg);
    return spiralIndexFromUnwrapped(unwrappedRef.current, sliceAngle, n);
}

/** True if a slot has a label, path, or nested filled slots (ignores empty editor padding). */
function isFilledSlot(item: MenuItem | undefined): boolean {
    if (!item) return false;
    if (item.name.trim() || item.path.trim()) return true;
    return (item.children ?? []).some(isFilledSlot);
}

function isGroupItem(item: MenuItem | undefined): boolean {
    if (!item) return false;
    if (isAutoGroup(item)) return true;
    const hasKids = (item.children ?? []).some(isFilledSlot);
    // Folder (no path) or hybrid/folder with real nested items
    return !item.path || hasKids;
}

function groupHasGrandRing(item: MenuItem | undefined): boolean {
    if (!item?.children) return false;
    return item.children.some(isGroupItem);
}

/** Demo parent/child/grand indices for Preferences live preview. */
function findDemoRingIndices(items: MenuItem[]): { main: number; child: number; grand: number } {
    for (let mi = 0; mi < items.length; mi++) {
        const main = items[mi];
        if (!isGroupItem(main)) continue;
        const children = main.children ?? [];
        for (let ci = 0; ci < children.length; ci++) {
            const child = children[ci];
            if (!isGroupItem(child)) continue;
            const grands = child.children ?? [];
            for (let gi = 0; gi < grands.length; gi++) {
                if (isFilledSlot(grands[gi])) {
                    return { main: mi, child: ci, grand: gi };
                }
            }
            if (isFilledSlot(child)) {
                return { main: mi, child: ci, grand: 0 };
            }
        }
        if (isFilledSlot(main) || children.some(isFilledSlot)) {
            return { main: mi, child: 0, grand: 0 };
        }
    }
    return { main: 0, child: 0, grand: 0 };
}

function resolveRingSlot(
    slotIdx: number,
    list: MenuItem[],
    spiral: boolean,
    base: number,
): { dataIdx: number; item: MenuItem | undefined } {
    const n = list.length;
    if (n === 0) return { dataIdx: slotIdx, item: undefined };
    if (spiral && n > maxChildrenVisibleConst) {
        const dataIdx = (base + slotIdx) % n;
        return { dataIdx, item: list[dataIdx] };
    }
    return { dataIdx: slotIdx, item: list[slotIdx] };
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
    const [prefsOpen, setPrefsOpen] = useState(false);
    const [previewTab, setPreviewTab] = useState<AppearancePreviewPayload['previewTab']>(null);
    const demoSavedRef = React.useRef<{ main: number | null; child: number | null; grand: number | null } | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const isDraggingRef = React.useRef(false);
    const dragPointerIdRef = React.useRef<number | null>(null);
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
    const childUnwrappedRef = React.useRef(0);
    const grandUnwrappedRef = React.useRef(0);
    const lastRawAngleChildRef = React.useRef<number | null>(null);
    const lastRawAngleGrandRef = React.useRef<number | null>(null);
    const [childSpiralBase, setChildSpiralBase] = useState(0);
    const [grandSpiralBase, setGrandSpiralBase] = useState(0);
    const lastDistanceRef = React.useRef(0);
    const lastAngleRef = React.useRef(0);
    const lastShowTimeRef = React.useRef(0);
    const clickThroughStateRef = React.useRef({ editorOpen: false, hitDiskRadius: 180 });
    const markingTrailRef = React.useRef<MarkingTrailPoint[]>([]);
    const captureRef = React.useRef<CaptureSample[]>([]);
    const gestureStartMsRef = React.useRef(0);
    const debugReviewTimerRef = React.useRef<number | null>(null);
    const [markingTrail, setMarkingTrail] = useState<MarkingTrailPoint[]>([]);
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
        autoN?: number;
        spiralTurn?: number;
    } | null>(null);

    const resetSpiralRefs = () => {
        childUnwrappedRef.current = 0;
        grandUnwrappedRef.current = 0;
        lastRawAngleChildRef.current = null;
        lastRawAngleGrandRef.current = null;
        setChildSpiralBase(0);
        setGrandSpiralBase(0);
    };

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
                invoke<MenuConfig>('sync_auto_items')
                    .then(config => {
                        setItems(config.items);
                        setConfigFull(config);
                    })
                    .catch(console.error);
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
                resetSpiralRefs();
                markingTrailRef.current = [];
                setMarkingTrail([]);
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
                resetSpiralRefs();
                markingTrailRef.current = [];
                setMarkingTrail([]);
                setCaptureTrail([]);
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
                setPrefsOpen(true);
                // Keep pie visible beside Preferences so threshold rings can be tuned live
                setIsVisible(true);
                lastShowTimeRef.current = Date.now();
            });
            const l7 = await listen('preferences-closed', () => {
                isPreferencesOpenRef.current = false;
                setPrefsOpen(false);
                setPreviewTab(null);
                demoSavedRef.current = null;
                // Discard unsaved appearance preview
                invoke<MenuConfig>('get_config')
                    .then(config => {
                        setItems(config.items);
                        setConfigFull(config);
                    })
                    .catch(console.error);
            });
            const l8 = await listen<AppearancePreviewPayload>('appearance-preview', (event) => {
                const patch = event.payload;
                if (!patch || typeof patch !== 'object') return;
                if (patch.previewTab !== undefined) {
                    setPreviewTab(patch.previewTab ?? null);
                }
                if (patch.replayOpenAnimation) {
                    setIsVisible(false);
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => setIsVisible(true));
                    });
                }
                setConfigFull(prev => {
                    if (!prev) return prev;
                    const { previewTab: _t, replayOpenAnimation: _r, ...appearancePatch } = patch;
                    return {
                        ...prev,
                        appearance: { ...prev.appearance, ...appearancePatch },
                    };
                });
            });
            return [l1, l2, l3, l4, l5, l6, l7, l8];
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

    const demoPreviewActive =
        prefsOpen
        && (previewTab === 'theme' || previewTab === 'opacity' || previewTab === 'animations');

    useEffect(() => {
        if (!demoPreviewActive) {
            if (demoSavedRef.current && !isDraggingRef.current) {
                updateActiveIndex(demoSavedRef.current.main);
                updateActiveChildIndex(demoSavedRef.current.child);
                setActiveGrandchildIndex(demoSavedRef.current.grand);
                demoSavedRef.current = null;
            }
            return;
        }
        if (isDraggingRef.current) return;
        if (!demoSavedRef.current) {
            demoSavedRef.current = {
                main: activeIndex,
                child: activeChildIndex,
                grand: activeGrandchildIndex,
            };
        }
        const demo = findDemoRingIndices(items);
        updateActiveIndex(demo.main);
        updateActiveChildIndex(demo.child);
        const childItem = items[demo.main]?.children?.[demo.child];
        if (isGroupItem(childItem)) {
            setActiveGrandchildIndex(demo.grand);
        } else {
            setActiveGrandchildIndex(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- demo ring setup when prefs tab changes
    }, [demoPreviewActive, previewTab, items]);


    const size = 1000;
    const center = size / 2;
    const rings = resolveRingGeometry(configFull?.appearance);
    const {
        innerRadius,
        outerRadius,
        childInnerRadius,
        childOuterRadius,
        grandInnerRadius,
        grandOuterRadius,
    } = rings;

    const sliceAngle = items.length > 0 ? 360 / items.length : 360;
    const halfSlice = sliceAngle / 2; // Offset so panels CENTER on cardinal directions

    // We will display 8 children slots per parent in a full circle
    const maxChildrenVisible = 8;
    const childFanAngle = 360; // Total angle span is a full circle
    const childSliceAngle = childFanAngle / maxChildrenVisible;
    const childHalfSlice = childSliceAngle / 2;

    const gestureDebug = !!configFull?.appearance?.gesture_path_debug;
    const gestureCapture = !!configFull?.appearance?.gesture_path_capture;
    /** Rings while debug/capture OR Preferences open (live threshold tuning). */
    const showThresholdRings = gestureDebug || gestureCapture || prefsOpen;
    /** HUD + capture analytics during debug/capture, or marking test in Preferences. */
    const showGestureOverlay = gestureDebug || gestureCapture || (prefsOpen && isDragging);
    /** Product marking trail — always on while dragging (except capture mode). */
    const showMarkingTrail = isDragging && !gestureCapture;
    const markingTrailSegs = React.useMemo(
        () => markingTrailSegments(markingTrail),
        [markingTrail],
    );
    const th = resolveGestureThresholds(configFull?.appearance);
    const DEAD_ZONE = 40;

    const pushMarkingTrail = (x: number, y: number) => {
        const next = pushMarkingTrailPoint(markingTrailRef.current, x, y);
        markingTrailRef.current = next;
        setMarkingTrail(next);
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

    const clearMarkingTrail = () => {
        markingTrailRef.current = [];
        setMarkingTrail([]);
    };

    const dismissMenu = () => {
        clearMarkingTrail();
        captureRef.current = [];
        setCaptureTrail([]);
        setDebugHud(null);
        resetSpiralRefs();
        setIsVisible(false);
        updateActiveIndex(null);
        updateActiveChildIndex(null);
        setActiveGrandchildIndex(null);
        invoke('hide_menu').catch(console.error);
    };

    /**
     * During a marking drag, middle-click reveals the active parent/child/grand
     * path in Explorer (folder open + item selected). Ends the gesture without launch.
     */
    const revealActivePanelPath = () => {
        if (!isDraggingRef.current) return;
        if (isEditorOpenRef.current) return;

        const launchMain = lockedMainRef.current ?? hoveredIndexRef.current;
        if (launchMain === null) return;

        const currentItem = configRef.current[launchMain];
        const launchChild = stickyChildRef.current;
        const launchGrand = stickyGrandRef.current;

        let path: string | null = null;
        if (
            launchChild !== null
            && launchGrand !== null
            && currentItem?.children
            && currentItem.children.length > launchChild
        ) {
            path = resolveRevealPath(currentItem.children[launchChild]?.children?.[launchGrand]);
        } else if (
            launchChild !== null
            && currentItem?.children
            && currentItem.children.length > launchChild
        ) {
            path = resolveRevealPath(currentItem.children[launchChild]);
        } else {
            path = resolveRevealPath(currentItem);
        }

        if (!path) return;

        isDraggingRef.current = false;
        setIsDragging(false);
        const pid = dragPointerIdRef.current;
        dragPointerIdRef.current = null;

        lockLevelRef.current = 0;
        lockedMainRef.current = null;
        stickyChildRef.current = null;
        stickyGrandRef.current = null;
        childLockedRef.current = false;
        finalizeCapture();

        invoke('reveal_in_explorer', { path }).catch(err => {
            console.error('[Hue] reveal_in_explorer failed:', err);
        });
        dismissMenu();

        // Best-effort: drop left-button capture so a later pointerup does not relaunch
        if (pid !== null) {
            const el = document.querySelector('.pie-menu-container');
            if (el) {
                try {
                    (el as HTMLElement).releasePointerCapture(pid);
                } catch {
                    /* ignore */
                }
            }
        }
    };

    const revealActivePanelPathRef = React.useRef(revealActivePanelPath);
    revealActivePanelPathRef.current = revealActivePanelPath;

    const endDragGesture = (e?: { currentTarget?: EventTarget | null; pointerId?: number }) => {
        if (!isDraggingRef.current) return;
        if (isEditorOpenRef.current) return;
        const prefsTest = isPreferencesOpenRef.current;
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

        if (!prefsTest) {
            finalizeCapture();
        }

        lockLevelRef.current = 0;
        lockedMainRef.current = null;
        stickyChildRef.current = null;
        stickyGrandRef.current = null;
        childLockedRef.current = false;

        if (prefsTest) {
            clearMarkingTrail();
            setDebugHud(null);
            resetSpiralRefs();
            if (launchMain !== null && lastDistanceRef.current >= DEAD_ZONE) {
                updateActiveIndex(launchMain);
                updateActiveChildIndex(launchChild);
                setActiveGrandchildIndex(launchGrand);
            }
            return;
        }

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
        if (e.button === 1) {
            e.preventDefault();
            e.stopPropagation();
            if (!isPreferencesOpenRef.current) {
                revealActivePanelPath();
            }
            return;
        }
        if (e.button !== 0) return;
        if (isEditorOpenRef.current) return;
        if (debugReviewTimerRef.current !== null) {
            window.clearTimeout(debugReviewTimerRef.current);
            debugReviewTimerRef.current = null;
        }
        isDraggingRef.current = true;
        setIsDragging(true);
        dragPointerIdRef.current = e.pointerId;
        lockLevelRef.current = 0;
        lockedMainRef.current = null;
        stickyChildRef.current = null;
        stickyGrandRef.current = null;
        childLockedRef.current = false;
        resetSpiralRefs();
        clearMarkingTrail();
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
        pushMarkingTrail(px, py);

        const adjusted = (angleDeg + halfSlice) % 360;
        const potentialMainIndex = Math.floor(adjusted / sliceAngle);

        const lockedMainEarly = lockedMainRef.current;
        const parentForChild = lockedMainEarly !== null ? items[lockedMainEarly] : undefined;
        const childList = parentForChild?.children ?? [];
        const childCount = childList.length;
        const childSpiral = isAutoGroup(parentForChild) && childCount > maxChildrenVisible;
        const potentialChildIndex = parentForChild
            ? ringIndexFromAngle(
                angleDeg,
                Math.max(childCount, maxChildrenVisible),
                childSliceAngle,
                childHalfSlice,
                childSpiral,
                childUnwrappedRef,
                lastRawAngleChildRef,
            )
            : Math.floor(((angleDeg + childHalfSlice) % 360) / childSliceAngle);

        const stickyChildEarly = stickyChildRef.current;
        const childForGrand = lockedMainEarly !== null && stickyChildEarly !== null
            ? items[lockedMainEarly]?.children?.[stickyChildEarly]
            : undefined;
        const grandList = childForGrand?.children ?? [];
        const grandCount = grandList.length;
        const grandSpiral = isAutoGroup(childForGrand) && grandCount > maxChildrenVisible;
        const potentialGrandIndex = childForGrand
            ? ringIndexFromAngle(
                angleDeg,
                Math.max(grandCount, maxChildrenVisible),
                childSliceAngle,
                childHalfSlice,
                grandSpiral,
                grandUnwrappedRef,
                lastRawAngleGrandRef,
            )
            : potentialChildIndex;

        if (childSpiral && childCount > maxChildrenVisible) {
            setChildSpiralBase(spiralBaseFromUnwrapped(childUnwrappedRef.current, childSliceAngle, childCount));
        }
        if (grandSpiral && grandCount > maxChildrenVisible) {
            setGrandSpiralBase(spiralBaseFromUnwrapped(grandUnwrappedRef.current, childSliceAngle, grandCount));
        }

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
        const childPickMin = th.childPickMin(mainHasPath);

        // ── Level 1: switch zone vs freeze zone; retrace only on entry sector ──
        if (lockLevelRef.current === 1 && lockedMain !== null) {
            const parentItem = items[lockedMain];
            const nChildren = parentItem?.children?.length ?? 0;
            const childSpiralActive = isAutoGroup(parentItem) && nChildren > maxChildrenVisible;
            const onChildPath =
                stickyChildRef.current !== null
                && potentialChildIndex === stickyChildRef.current;

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
                && (childSpiralActive ? potentialChildIndex < nChildren : potentialChildIndex < maxChildrenVisible)
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
                // PATH ZONE (outer half of child+) — freeze child; group → grand by angle
                if (
                    stickyChildRef.current === null
                    && potentialChildIndex >= 0
                    && (childSpiralActive ? potentialChildIndex < nChildren : potentialChildIndex < maxChildrenVisible)
                ) {
                    stickyChildRef.current = potentialChildIndex;
                    captureEvent = captureEvent ?? 'child_commit';
                }
                if (stickyChildRef.current !== null) {
                    childLockedRef.current = true;
                    const childItem = items[lockedMain]?.children?.[stickyChildRef.current];
                    if (isGroupItem(childItem)) {
                        // Outer half is corridor to grand — do not wait for grand ring (300)
                        lockLevelRef.current = 2;
                        captureEvent = captureEvent ?? 'path_grand';
                    } else {
                        stickyGrandRef.current = null;
                    }
                }
                syncSelectionFromSticky();
            } else if (childLockedRef.current || stickyChildRef.current !== null) {
                // Parent band off-path: keep selection, do not close via wrong sector
                syncSelectionFromSticky();
            }
        }

        // ── Level 2: grand by angle from outer child half; child frozen; retrace = inner half on entry ──
        if (lockLevelRef.current === 2 && lockedMain !== null) {
            childLockedRef.current = true;
            const stickyChild = stickyChildRef.current;
            const childItem = stickyChild !== null ? items[lockedMain]?.children?.[stickyChild] : undefined;
            const nGrand = childItem?.children?.length ?? 0;
            const grandSpiralActive = isAutoGroup(childItem) && nGrand > maxChildrenVisible;
            const onChildPath =
                stickyChild !== null && potentialChildIndex === stickyChild;

            if (distance < DEAD_ZONE) {
                stickyChildRef.current = null;
                stickyGrandRef.current = null;
                childLockedRef.current = false;
                lockLevelRef.current = 0;
                lockedMainRef.current = null;
                updateActiveIndex(null);
                captureEvent = captureEvent ?? 'dead_unlock';
            } else if (onChildPath && distance < th.childSwitchMax) {
                // Back into inner half of child on entry corridor → leave grand, allow child switch
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
                && distance >= th.childSwitchMax
                && potentialGrandIndex >= 0
                && (grandSpiralActive ? potentialGrandIndex < nGrand : potentialGrandIndex < maxChildrenVisible)
            ) {
                // Path / grand zone: pick grand by angle (even while skimming other child panels)
                if (stickyGrandRef.current !== potentialGrandIndex) {
                    captureEvent = captureEvent ?? 'grand_switch';
                }
                stickyGrandRef.current = potentialGrandIndex;
            }
            // Off-path in path zone: keep child+grand — brush other children without switching
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
            const spiralParent = lockedMainRef.current !== null ? items[lockedMainRef.current] : undefined;
            const spiralN = spiralParent?.children?.length ?? 0;
            setDebugHud({
                lock: lockLevelRef.current,
                dist: Math.round(distance),
                angle: Math.round(angleDeg),
                main: lockedMainRef.current ?? hoveredIndexRef.current,
                child: stickyChildRef.current,
                grand: stickyGrandRef.current,
                zone,
                childSwitchable,
                autoN: isAutoGroup(spiralParent) && spiralN > maxChildrenVisible ? spiralN : undefined,
                spiralTurn: isAutoGroup(spiralParent) && spiralN > maxChildrenVisible
                    ? Math.floor(childUnwrappedRef.current / 360)
                    : undefined,
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
        // Fallback: some WebViews drop contextmenu while left-button capture is held
        if (e.button === 2) {
            e.preventDefault();
            e.stopPropagation();
            openEditorAtClientPoint(e.clientX, e.clientY, e.currentTarget);
            return;
        }
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
        // Middle button while left is captured often arrives on window, not the pie target
        const onWinMiddleDown = (ev: PointerEvent) => {
            if (ev.button !== 1) return;
            ev.preventDefault();
            ev.stopPropagation();
            revealActivePanelPathRef.current();
        };
        const onWinMiddleMouseDown = (ev: MouseEvent) => {
            if (ev.button !== 1) return;
            // Prevent browser autoscroll / default middle-click behavior
            ev.preventDefault();
        };
        window.addEventListener('pointerup', onWinUp);
        window.addEventListener('pointercancel', onWinCancel);
        window.addEventListener('pointerdown', onWinMiddleDown, true);
        window.addEventListener('mousedown', onWinMiddleMouseDown, true);
        return () => {
            window.removeEventListener('pointerup', onWinUp);
            window.removeEventListener('pointercancel', onWinCancel);
            window.removeEventListener('pointerdown', onWinMiddleDown, true);
            window.removeEventListener('mousedown', onWinMiddleMouseDown, true);
        };
    }, [isDragging]);

    const lastEditorOpenMsRef = React.useRef(0);

    /** Stop marking drag without launch/dismiss so a slice editor can open. */
    const abortDragForEditor = (target: EventTarget | null) => {
        if (!isDraggingRef.current) return;
        isDraggingRef.current = false;
        setIsDragging(false);
        const pid = dragPointerIdRef.current;
        dragPointerIdRef.current = null;
        if (target && pid !== null) {
            try {
                (target as HTMLElement).releasePointerCapture(pid);
            } catch {
                /* ignore */
            }
        }
        finalizeCapture();
    };

    /** Resolve pie coords → open slice editor. Shared by contextmenu + right-button pointerup. */
    const openEditorAtClientPoint = (
        clientX: number,
        clientY: number,
        currentTarget: EventTarget | null,
    ) => {
        if (isPreferencesOpenRef.current) return;
        if (isEditorOpenRef.current) return;
        const now = Date.now();
        if (now - lastEditorOpenMsRef.current < 280) return;

        const el = currentTarget as HTMLElement | null;
        if (!el?.getBoundingClientRect) return;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const scaleX = size / rect.width;
        const scaleY = size / rect.height;
        const dx = (clientX - rect.left) * scaleX - center;
        const dy = (clientY - rect.top) * scaleY - center;
        const distance = Math.sqrt(dx * dx + dy * dy);
        let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        angleDeg = (angleDeg + 90 + 360) % 360;

        const potentialMainIndex = Math.floor(((angleDeg + halfSlice) % 360) / sliceAngle);
        const slotIdx = Math.floor(((angleDeg + childHalfSlice) % 360) / childSliceAngle);

        const parentIdx = lockedMainRef.current
            ?? (activeIndex !== null && isGroupItem(items[activeIndex]) ? activeIndex : null)
            ?? (hoveredIndexRef.current !== null && isGroupItem(items[hoveredIndexRef.current])
                ? hoveredIndexRef.current
                : null);
        const parentItem = parentIdx !== null ? items[parentIdx] : undefined;
        const childList = parentItem?.children ?? [];
        const childSpiralCtx = isAutoGroup(parentItem) && childList.length > maxChildrenVisible;
        const childDataIdx = childSpiralCtx && childList.length > 0
            ? (childSpiralBase + slotIdx) % childList.length
            : slotIdx;
        const stickyChild = stickyChildRef.current ?? activeChildIndex;
        const childItem = parentIdx !== null && stickyChild !== null
            ? items[parentIdx]?.children?.[stickyChild]
            : undefined;
        const grandList = childItem?.children ?? [];
        const grandSpiralCtx = isAutoGroup(childItem) && grandList.length > maxChildrenVisible;
        const grandDataIdx = grandSpiralCtx && grandList.length > 0
            ? (grandSpiralBase + slotIdx) % grandList.length
            : slotIdx;

        abortDragForEditor(currentTarget);

        const inChildBand =
            distance >= childInnerRadius - 8
            && distance <= childOuterRadius + 8;
        const inGrandBand =
            distance > childOuterRadius - 8
            && distance <= grandOuterRadius + 24;

        // Grand ring
        if (
            parentIdx !== null
            && stickyChild !== null
            && isGroupItem(childItem)
            && inGrandBand
            && slotIdx >= 0
            && slotIdx < maxChildrenVisible
        ) {
            lastEditorOpenMsRef.current = now;
            handleOpenEditor(parentIdx, stickyChild, grandDataIdx);
            return;
        }

        // Child ring — always allow (empty slots open editor to configure)
        if (
            parentIdx !== null
            && isGroupItem(parentItem)
            && inChildBand
            && slotIdx >= 0
            && slotIdx < maxChildrenVisible
        ) {
            lastEditorOpenMsRef.current = now;
            handleOpenEditor(parentIdx, childDataIdx);
            return;
        }

        // Main ring
        if (
            distance >= DEAD_ZONE
            && distance < childInnerRadius
            && potentialMainIndex >= 0
            && potentialMainIndex < items.length
        ) {
            lastEditorOpenMsRef.current = now;
            handleOpenEditor(potentialMainIndex);
        }
    };

    // Right-click opens slice editor. Pointer capture can steal path-level contextmenu during drag.
    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        openEditorAtClientPoint(e.clientX, e.clientY, e.currentTarget);
    };

    const handleOpenEditor = (index: number, childIdx: number | null = null, grandchildIdx: number | null = null) => {
        if (isPreferencesOpenRef.current) return;
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
            className={`pie-menu-container ${isVisible ? 'visible' : ''} ${animClass}${isDragging ? ' dragging' : ''}${prefsOpen ? ' prefs-marking-test' : ''}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onContextMenu={handleContextMenu}
            style={customStyles}
        >
            {prefsOpen && (
                <div className="pie-prefs-test-badge" aria-hidden="true">
                    {isDragging ? 'Marking test…' : 'Marking test — preview only'}
                </div>
            )}

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

                    const childList = currentItem.children ?? [];
                    const childSpiral = isAutoGroup(currentItem) && childList.length > maxChildrenVisible;
                    const parentAuto = isAutoGroup(currentItem);

                    return Array.from({ length: maxChildrenVisible }).map((_, slotIdx) => {
                        const { dataIdx, item: child } = resolveRingSlot(slotIdx, childList, childSpiral, childSpiralBase);
                        const startAngle = slotIdx * childSliceAngle - childHalfSlice;
                        const endAngle = startAngle + childSliceAngle - 2;
                        const pathD = describeArc(center, center, childInnerRadius, childOuterRadius, startAngle, endAngle);
                        const isChildActive = activeChildIndex === dataIdx;
                        const hasContent = !!child && (child.name.trim() || child.path.trim());

                        return (
                            <path
                                key={`child-${activeIndex}-${slotIdx}-${dataIdx}`}
                                d={pathD}
                                className={`slice-path outer-slice${parentAuto ? ' auto-slice' : ''} ${isChildActive ? 'active' : ''} ${hoverAnimClass}`}
                                style={{
                                    opacity: !hasContent
                                        ? 0.15
                                        : isGrandGroupOpen && activeChildIndex !== dataIdx
                                            ? 0.3
                                            : undefined,
                                }}
                                onContextMenu={e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    abortDragForEditor(e.currentTarget.ownerSVGElement?.parentElement ?? null);
                                    lastEditorOpenMsRef.current = Date.now();
                                    handleOpenEditor(activeIndex, dataIdx);
                                }}
                            />
                        );
                    });
                })()}
                {/* ── Grandchild ring ── */}
                {isGrandGroupOpen && activeIndex !== null && activeChildIndex !== null && (() => {
                    const childItem = items[activeIndex]?.children?.[activeChildIndex];
                    if (!childItem || !isGroupItem(childItem)) return null;

                    const grandList = childItem.children ?? [];
                    const grandSpiral = isAutoGroup(childItem) && grandList.length > maxChildrenVisible;
                    const childAuto = isAutoGroup(childItem);

                    return Array.from({ length: maxChildrenVisible }).map((_, slotIdx) => {
                        const { dataIdx, item: grand } = resolveRingSlot(slotIdx, grandList, grandSpiral, grandSpiralBase);
                        const startAngle = slotIdx * childSliceAngle - childHalfSlice;
                        const endAngle = startAngle + childSliceAngle - 2;
                        const pathD = describeArc(center, center, grandInnerRadius, grandOuterRadius, startAngle, endAngle);
                        const isGrandActive = activeGrandchildIndex === dataIdx;
                        const hasContent = !!grand && (grand.name.trim() || grand.path.trim());

                        return (
                            <path
                                key={`grand-${activeIndex}-${activeChildIndex}-${slotIdx}-${dataIdx}`}
                                d={pathD}
                                className={`slice-path outer-slice${childAuto ? ' auto-slice' : ''} ${isGrandActive ? 'active' : ''} ${hoverAnimClass}`}
                                style={{ opacity: !hasContent ? 0.15 : undefined }}
                                onContextMenu={e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    abortDragForEditor(e.currentTarget.ownerSVGElement?.parentElement ?? null);
                                    lastEditorOpenMsRef.current = Date.now();
                                    handleOpenEditor(activeIndex, activeChildIndex, dataIdx);
                                }}
                            />
                        );
                    });
                })()}
            </svg>

            {showMarkingTrail && markingTrail.length > 0 && (
                <svg
                    className="gesture-marking-overlay"
                    viewBox={`0 0 ${size} ${size}`}
                    pointerEvents="none"
                >
                    <defs>
                        <filter id="marking-trail-glow" x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation="3" result="blur" />
                            <feMerge>
                                <feMergeNode in="blur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>
                    <g className="gesture-marking-trail" filter="url(#marking-trail-glow)">
                        {markingTrailSegs.map((seg, i) => (
                            <g key={`mt-${i}`}>
                                <line
                                    className="gesture-marking-trail-glow"
                                    x1={seg.x1}
                                    y1={seg.y1}
                                    x2={seg.x2}
                                    y2={seg.y2}
                                    strokeWidth={seg.width * 2.4}
                                    opacity={seg.opacity * 0.22}
                                />
                                <line
                                    className="gesture-marking-trail-core"
                                    x1={seg.x1}
                                    y1={seg.y1}
                                    x2={seg.x2}
                                    y2={seg.y2}
                                    strokeWidth={seg.width}
                                    opacity={seg.opacity * 0.92}
                                />
                            </g>
                        ))}
                    </g>
                    {(() => {
                        const last = markingTrail[markingTrail.length - 1];
                        if (!last) return null;
                        return (
                            <g className="gesture-marking-head">
                                <circle cx={last.x} cy={last.y} r={10} className="gesture-marking-head-halo" />
                                <circle cx={last.x} cy={last.y} r={4.5} className="gesture-marking-head-core" />
                            </g>
                        );
                    })()}
                </svg>
            )}

            {/* Unrotated overlay: pie-svg uses rotate(-90deg), so trail/rings must live outside it */}
            {showThresholdRings && (
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
                    <g className="gesture-debug-ring-labels">
                        {[
                            { r: th.retraceChild, label: `retrace child ${th.retraceChild}`, cls: 'retrace' },
                            { r: th.retraceGrand, label: `retrace grand ${th.retraceGrand}`, cls: 'retrace' },
                            { r: th.childSwitchMax, label: `half split ${Math.round(th.childSplitRatio * 100)}%`, cls: 'commit' },
                            { r: th.grandEnter, label: `grand ${th.grandEnter}`, cls: 'grand' },
                            { r: th.grandEnterHybrid, label: `hybrid ${th.grandEnterHybrid}`, cls: 'grand' },
                        ].map(({ r, label, cls }) => (
                            <text
                                key={label}
                                className={`gesture-debug-ring-label ${cls}`}
                                x={center + 8}
                                y={center - r + 4}
                            >
                                {label}
                            </text>
                        ))}
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
                        : null}
                </svg>
            )}

            {/* Sub-menu labels */}
            {activeIndex !== null && (() => {
                const currentItem = items[activeIndex];
                if (!currentItem) return null;
                if (!isGroupItem(currentItem)) return null;

                const childList = currentItem.children ?? [];
                const childSpiral = isAutoGroup(currentItem) && childList.length > maxChildrenVisible;
                const parentAuto = isAutoGroup(currentItem);

                return Array.from({ length: maxChildrenVisible }).map((_, slotIdx) => {
                    const { dataIdx, item: child } = resolveRingSlot(slotIdx, childList, childSpiral, childSpiralBase);
                    const midAngle = slotIdx * childSliceAngle;

                    const textRadius = childInnerRadius + (childOuterRadius - childInnerRadius) / 2;
                    const angleInRadians = ((midAngle - 90) * Math.PI) / 180.0;
                    const x = center + textRadius * Math.cos(angleInRadians);
                    const y = center + textRadius * Math.sin(angleInRadians);

                    const childName = child?.name ? child.name : "＋";
                    const isPlaceholder = !child?.name && !child?.path;
                    const childIsGroup = isGroupItem(child);

                    return (
                        <div
                            key={`child-label-${activeIndex}-${slotIdx}-${dataIdx}`}
                            className={`slice-content outer-label${parentAuto ? ' auto-label' : ''}`}
                            style={{
                                left: `${x}px`,
                                top: `${y}px`,
                                opacity: isGrandGroupOpen && activeChildIndex !== dataIdx
                                    ? 0.3
                                    : isPlaceholder
                                        ? 0.3
                                        : 1,
                            }}
                            onPointerDown={e => {
                                if (e.button === 2) e.stopPropagation();
                            }}
                            onPointerUp={e => {
                                if (e.button === 2) {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    abortDragForEditor(e.currentTarget.parentElement);
                                    lastEditorOpenMsRef.current = Date.now();
                                    handleOpenEditor(activeIndex, dataIdx);
                                }
                            }}
                            onContextMenu={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                abortDragForEditor(e.currentTarget.parentElement);
                                lastEditorOpenMsRef.current = Date.now();
                                handleOpenEditor(activeIndex, dataIdx);
                            }}
                        >
                            {parentAuto && !isPlaceholder && (
                                <span className="auto-badge">Auto</span>
                            )}
                            {childName}
                            {childIsGroup && (
                                <div style={{ fontSize: '12px', lineHeight: 1, marginTop: '2px', color: 'rgba(255,255,255,0.4)', opacity: activeChildIndex === dataIdx ? 1 : 0.5 }}>
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

                const grandList = childItem.children ?? [];
                const grandSpiral = isAutoGroup(childItem) && grandList.length > maxChildrenVisible;
                const childAuto = isAutoGroup(childItem);

                return Array.from({ length: maxChildrenVisible }).map((_, slotIdx) => {
                    const { dataIdx, item: grand } = resolveRingSlot(slotIdx, grandList, grandSpiral, grandSpiralBase);
                    const midAngle = slotIdx * childSliceAngle;

                    const textRadius = grandInnerRadius + (grandOuterRadius - grandInnerRadius) / 2;
                    const angleInRadians = ((midAngle - 90) * Math.PI) / 180.0;
                    const x = center + textRadius * Math.cos(angleInRadians);
                    const y = center + textRadius * Math.sin(angleInRadians);

                    const grandName = grand?.name ? grand.name : "＋";
                    const isPlaceholder = !grand?.name && !grand?.path;

                    return (
                        <div
                            key={`grand-label-${activeIndex}-${activeChildIndex}-${slotIdx}-${dataIdx}`}
                            className={`slice-content outer-label${childAuto ? ' auto-label' : ''}`}
                            style={{ left: `${x}px`, top: `${y}px`, opacity: isPlaceholder ? 0.3 : 1 }}
                            onPointerDown={e => {
                                if (e.button === 2) e.stopPropagation();
                            }}
                            onPointerUp={e => {
                                if (e.button === 2) {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    abortDragForEditor(e.currentTarget.parentElement);
                                    lastEditorOpenMsRef.current = Date.now();
                                    handleOpenEditor(activeIndex, activeChildIndex, dataIdx);
                                }
                            }}
                            onContextMenu={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                abortDragForEditor(e.currentTarget.parentElement);
                                lastEditorOpenMsRef.current = Date.now();
                                handleOpenEditor(activeIndex, activeChildIndex, dataIdx);
                            }}
                        >
                            {childAuto && !isPlaceholder && (
                                <span className="auto-badge">Auto</span>
                            )}
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

            {/* Center label */}
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
                {(configFull?.appearance?.center_label ?? 'HUE').trim() && (
                    <div className="center-text">
                        {configFull?.appearance?.center_label?.trim() || 'HUE'}
                    </div>
                )}
            </div>

            {showGestureOverlay && debugHud && (
                <div className="gesture-debug-hud" style={{ pointerEvents: 'none' }}>
                    <div>lock {debugHud.lock} · dist {debugHud.dist} · ang {debugHud.angle}° · zone {debugHud.zone}</div>
                    <div>main {debugHud.main ?? '—'} · child {debugHud.child ?? '—'} · grand {debugHud.grand ?? '—'}</div>
                    <div className="gesture-debug-hud-hint">
                        child {debugHud.childSwitchable ? 'SWITCH (inner half)' : 'PATH→grand (outer half)'}
                        {' · '}split@{Math.round(th.childSplitRatio * 100)}%
                        {prefsOpen ? ' · preview only' : ''}
                        {gestureCapture ? ' · capture→console/localStorage' : ''}
                        {debugHud.autoN !== undefined ? ` · auto ${debugHud.autoN} turn ${debugHud.spiralTurn ?? 0}` : ''}
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

                const parentUsesAuto =
                    editingChildIndex !== null
                    && !!items[editingIndex]?.auto?.enabled;

                return (
                <SliceEditor
                    key={editorKey}
                    item={editingItem}
                    position={editingPos}
                    allowChildren={editingGrandchildIndex === null}
                    allowAuto={!parentUsesAuto}
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
