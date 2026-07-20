import type { AppearanceConfig } from '../components/PieMenu';

/** Inner edge of the parent ring (center hole boundary). */
export const CENTER_HOLE_RADIUS = 70;

/** Default total radial span (parent + child + grand) at scale 1.0. */
export const DEFAULT_RING_SPAN = 350;

export type RingGeometry = {
    innerRadius: number;
    outerRadius: number;
    childInnerRadius: number;
    childOuterRadius: number;
    grandInnerRadius: number;
    grandOuterRadius: number;
    parentThickness: number;
    childThickness: number;
    grandThickness: number;
    childMidRadius: number;
    ringSpanScale: number;
    parentWeight: number;
    childWeight: number;
    grandWeight: number;
};

export type GestureThresholds = {
    childSwitchMax: number;
    grandEnter: number;
    grandEnterHybrid: number;
    retraceGrand: number;
    retraceChild: number;
    childPickMin: (mainHasPath: boolean) => number;
    childSplitRatio: number;
    rings: RingGeometry;
};

function legacyThicknessToWeights(appearance: AppearanceConfig): {
    parent: number;
    child: number;
    grand: number;
    spanScale: number;
} {
    const parent = appearance.parent_ring_thickness ?? 110;
    const child = appearance.child_ring_thickness ?? 120;
    const grand = appearance.grand_ring_thickness ?? 120;
    const sum = parent + child + grand;
    return {
        parent,
        child,
        grand,
        spanScale: sum / DEFAULT_RING_SPAN,
    };
}

export function resolveRingGeometry(appearance?: AppearanceConfig | null): RingGeometry {
    let parentWeight = appearance?.parent_ring_weight ?? 110;
    let childWeight = appearance?.child_ring_weight ?? 120;
    let grandWeight = appearance?.grand_ring_weight ?? 120;
    let spanScale = appearance?.ring_span_scale ?? 1;

    if (
        appearance?.parent_ring_weight == null
        && appearance?.parent_ring_thickness != null
    ) {
        const legacy = legacyThicknessToWeights(appearance);
        parentWeight = legacy.parent;
        childWeight = legacy.child;
        grandWeight = legacy.grand;
        spanScale = legacy.spanScale;
    }

    const weightSum = Math.max(parentWeight + childWeight + grandWeight, 1);
    const totalBand = DEFAULT_RING_SPAN * spanScale;
    const parentThickness = totalBand * (parentWeight / weightSum);
    const childThickness = totalBand * (childWeight / weightSum);
    const grandThickness = totalBand * (grandWeight / weightSum);

    const innerRadius = CENTER_HOLE_RADIUS;
    const outerRadius = innerRadius + parentThickness;
    const childInnerRadius = outerRadius;
    const childOuterRadius = childInnerRadius + childThickness;
    const grandInnerRadius = childOuterRadius;
    const grandOuterRadius = grandInnerRadius + grandThickness;

    return {
        innerRadius,
        outerRadius,
        childInnerRadius,
        childOuterRadius,
        grandInnerRadius,
        grandOuterRadius,
        parentThickness,
        childThickness,
        grandThickness,
        childMidRadius: (childInnerRadius + childOuterRadius) / 2,
        ringSpanScale: spanScale,
        parentWeight,
        childWeight,
        grandWeight,
    };
}

function ratioInChildRing(appearance: AppearanceConfig | null | undefined, rings: RingGeometry): number {
    if (appearance?.gesture_child_split_ratio != null) {
        return clampChildSplitRatio(appearance.gesture_child_split_ratio);
    }
    const legacy = appearance?.gesture_child_switch_max;
    if (legacy != null && rings.childThickness > 0) {
        return clampChildSplitRatio((legacy - rings.childInnerRadius) / rings.childThickness);
    }
    return 0.5;
}

/** Inner/outer child-band split — UI allows 20–80% of child ring depth. */
function clampChildSplitRatio(v: number): number {
    return Math.min(0.8, Math.max(0.2, v));
}

function ratioInParentRing(
    appearance: AppearanceConfig | null | undefined,
    rings: RingGeometry,
    ratioKey: 'gesture_path_pick_ratio' | 'gesture_retrace_child_ratio',
    legacyPxKey: 'gesture_retrace_child',
    defaultRatio: number,
): number {
    const ratio = appearance?.[ratioKey];
    if (ratio != null) return clampRatio(ratio);
    const legacy = appearance?.[legacyPxKey];
    if (legacy != null && rings.parentThickness > 0) {
        return clampRatio((legacy - rings.innerRadius) / rings.parentThickness);
    }
    return defaultRatio;
}

function clampRatio(v: number): number {
    return Math.min(0.95, Math.max(0.05, v));
}

export function resolveGestureThresholds(appearance?: AppearanceConfig | null): GestureThresholds {
    const rings = resolveRingGeometry(appearance);
    const childSplitRatio = ratioInChildRing(appearance, rings);
    const pathPickRatio = ratioInParentRing(
        appearance,
        rings,
        'gesture_path_pick_ratio',
        'gesture_retrace_child',
        0.636,
    );
    const retraceChildRatio = ratioInParentRing(
        appearance,
        rings,
        'gesture_retrace_child_ratio',
        'gesture_retrace_child',
        0.636,
    );
    const hybridExtraRatio = appearance?.gesture_grand_hybrid_extra_ratio ?? 0.167;

    const childSwitchMax = rings.childInnerRadius + rings.childThickness * childSplitRatio;
    const retraceChild = rings.innerRadius + rings.parentThickness * retraceChildRatio;

    return {
        childSwitchMax,
        grandEnter: rings.childOuterRadius,
        grandEnterHybrid: rings.childOuterRadius + rings.childThickness * hybridExtraRatio,
        retraceGrand: rings.childInnerRadius,
        retraceChild,
        childPickMin: (mainHasPath: boolean) =>
            mainHasPath
                ? rings.innerRadius + rings.parentThickness * pathPickRatio
                : rings.innerRadius,
        childSplitRatio,
        rings,
    };
}

/** Share of total ring band (0–100) for UI labels. */
export function ringWeightPercents(rings: RingGeometry): { parent: number; child: number; grand: number } {
    const sum = rings.parentWeight + rings.childWeight + rings.grandWeight;
    if (sum <= 0) return { parent: 33, child: 33, grand: 34 };
    return {
        parent: Math.round((rings.parentWeight / sum) * 100),
        child: Math.round((rings.childWeight / sum) * 100),
        grand: Math.round((rings.grandWeight / sum) * 100),
    };
}
