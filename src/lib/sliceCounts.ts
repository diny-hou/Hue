import type { SliceItem } from '../components/SliceEditor';

export const MIN_SLICE_COUNT = 1;
export const MAX_SLICE_COUNT = 8;
export const DEFAULT_SLICE_COUNT = 8;

export function clampSliceCount(value: unknown, fallback = DEFAULT_SLICE_COUNT): number {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(MAX_SLICE_COUNT, Math.max(MIN_SLICE_COUNT, n));
}

export function emptySliceItem(): SliceItem {
    return { name: '', path: '', children: [], auto: null };
}

/** Resize parent ring slots (truncate or pad empty). */
export function resizeParentItems(items: SliceItem[], count: number): SliceItem[] {
    const n = clampSliceCount(count);
    const next = items.slice(0, n).map((item) => ({ ...item }));
    while (next.length < n) {
        next.push(emptySliceItem());
    }
    return next;
}

function padOrTrimSlots(list: SliceItem[], count: number): SliceItem[] {
    const n = clampSliceCount(count);
    const next = list.slice(0, n).map((item) => ({ ...item }));
    while (next.length < n) {
        next.push(emptySliceItem());
    }
    return next;
}

/**
 * For manual (non-Auto) groups, keep child/grand lists aligned to slot counts.
 * Auto groups keep their full synced file list (spiral when longer than slots).
 */
export function applyChildGrandSlotLimits(
    items: SliceItem[],
    childSlots: number,
    grandSlots: number,
): SliceItem[] {
    const childN = clampSliceCount(childSlots);
    const grandN = clampSliceCount(grandSlots);
    return items.map((parent) => {
        if (parent.auto?.enabled) {
            return {
                ...parent,
                children: (parent.children ?? []).map((child) => {
                    if (child.auto?.enabled) return child;
                    return { ...child, children: padOrTrimSlots(child.children ?? [], grandN) };
                }),
            };
        }
        const children = padOrTrimSlots(parent.children ?? [], childN).map((child) => {
            if (child.auto?.enabled) return child;
            return { ...child, children: padOrTrimSlots(child.children ?? [], grandN) };
        });
        return { ...parent, children };
    });
}
