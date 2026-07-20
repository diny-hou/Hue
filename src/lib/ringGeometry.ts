import type { AppearanceConfig } from '../components/PieMenu';

/** Inner edge of the parent ring (center hole boundary). */
export const CENTER_HOLE_RADIUS = 70;

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
};

export function resolveRingGeometry(appearance?: AppearanceConfig | null): RingGeometry {
    const parentThickness = appearance?.parent_ring_thickness ?? 110;
    const childThickness = appearance?.child_ring_thickness ?? 120;
    const grandThickness = appearance?.grand_ring_thickness ?? 120;

    const innerRadius = CENTER_HOLE_RADIUS;
    const outerRadius = innerRadius + parentThickness;
    const childInnerRadius = outerRadius;
    const childOuterRadius = childInnerRadius + childThickness;
    const grandInnerRadius = childOuterRadius;
    const grandOuterRadius = grandInnerRadius + grandThickness;
    const childMidRadius = (childInnerRadius + childOuterRadius) / 2;

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
        childMidRadius,
    };
}
