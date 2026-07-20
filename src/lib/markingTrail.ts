/** Path length (px) behind the cursor before the trail fully fades out. */
export const MARKING_TRAIL_FADE_PX = 180;

export type MarkingTrailPoint = { x: number; y: number; arc: number };

export type MarkingTrailSegment = {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    opacity: number;
    width: number;
};

export function pushMarkingTrailPoint(
    trail: MarkingTrailPoint[],
    x: number,
    y: number,
    minDistSq = 4,
): MarkingTrailPoint[] {
    const last = trail[trail.length - 1];
    let arc = last?.arc ?? 0;
    if (last) {
        const dx = x - last.x;
        const dy = y - last.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < minDistSq) return trail;
        arc += Math.sqrt(distSq);
    }
    const next = [...trail, { x, y, arc }];
    const cutoff = arc - MARKING_TRAIL_FADE_PX - 24;
    let start = 0;
    while (start < next.length - 2 && next[start].arc < cutoff) {
        start += 1;
    }
    return start > 0 ? next.slice(start) : next;
}

export function markingTrailSegments(
    points: MarkingTrailPoint[],
    fadeLen = MARKING_TRAIL_FADE_PX,
): MarkingTrailSegment[] {
    if (points.length < 2) return [];
    const headArc = points[points.length - 1].arc;
    const segs: MarkingTrailSegment[] = [];
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const behind = headArc - curr.arc;
        if (behind >= fadeLen) continue;
        const t = behind / fadeLen;
        const opacity = Math.pow(1 - t, 1.55);
        const width = 1.5 + opacity * 4.5;
        segs.push({
            x1: prev.x,
            y1: prev.y,
            x2: curr.x,
            y2: curr.y,
            opacity,
            width,
        });
    }
    return segs;
}
